package cl.cloudcoffee.order_service.service;

import static org.assertj.core.api.Assertions.*;
import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
import cl.cloudcoffee.order_service.model.*;
import cl.cloudcoffee.order_service.repository.*;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = {"management.tracing.enabled=false", "cloudcoffee.idempotencia.enabled=false"})
class RetencionIdempotenciasTests extends JwtTestSupport {
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager manager;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;
    @Autowired RegistroIdempotenciaRepository idempotencias;
    @Autowired SimulacionPagoService simulacion;
    static final Instant AHORA = Instant.parse("2027-01-01T12:00:00Z");
    static final Instant CORTE = AHORA.minus(Duration.ofDays(30));
    RetencionIdempotencias job(int lote) { return new RetencionIdempotencias(jdbc, Clock.fixed(AHORA, ZoneOffset.UTC), manager, Duration.ofDays(30), lote); }

    @Test
    void protegeActivasYBordeExactoLimpiaLotesYReiniciaSinPerderHistorial() throws Exception {
        UUID vieja = creacion("TERMINADA", CORTE.minusSeconds(1));
        UUID borde = creacion("TERMINADA", CORTE);
        UUID reciente = creacion("TERMINADA", AHORA.minusSeconds(1));
        UUID nueva = creacion("NUEVA", CORTE.minusSeconds(10));
        UUID reservando = creacion("RESERVANDO", CORTE.minusSeconds(10));
        UUID completadaTarde = creacion("TERMINADA", AHORA);
        jdbc.update("UPDATE creacion_compras SET created_at=? WHERE id=?", utc(CORTE.minusSeconds(100)), completadaTarde);
        job(100).limpiar();
        assertThat(existe("creacion_compras", vieja)).isFalse();
        for (UUID id : List.of(borde, reciente, nueva, reservando, completadaTarde)) assertThat(existe("creacion_compras", id)).isTrue();

        // Un lote de 1 y un worker reiniciado continúan, sin reejecutar el negocio.
        UUID a = creacion("TERMINADA", CORTE.minusSeconds(5)), b = creacion("TERMINADA", CORTE.minusSeconds(4));
        job(1).limpiar();
        assertThat(existe("creacion_compras", a)).isFalse(); assertThat(existe("creacion_compras", b)).isTrue();
        job(1).limpiar(); assertThat(existe("creacion_compras", b)).isFalse();

        Compra compra = compras.saveAndFlush(new Compra(UUID.randomUUID(), new BigDecimal("1000")));
        Pago pago = new Pago(compra, "SIMULADO", null); pago.aplicarResultado(EstadoPago.RECHAZADO, null); pagos.saveAndFlush(pago);
        jdbc.update("UPDATE compras SET estado='CANCELADO', monto_total=0 WHERE id=?", compra.getId());
        String ruta = "/compras/" + compra.getId() + "/pago";
        UUID clave = UUID.randomUUID();
        var registro = new RegistroIdempotencia(compra.getUsuarioId(), "POST", ruta, clave, "a".repeat(64), 201, "{}", null);
        registro.completar(CORTE.minusSeconds(1));
        var id = guardar(registro);
        UUID reserva = UUID.randomUUID();
        jdbc.update("INSERT INTO liberaciones_reserva(reserva_id, compra_id, created_at) VALUES(?,?,?)", reserva, compra.getId(), utc(CORTE));
        job(100).limpiar(); assertThat(existe("idempotencia", id)).isTrue();
        jdbc.update("DELETE FROM liberaciones_reserva WHERE reserva_id=?", reserva);
        job(100).limpiar(); assertThat(existe("idempotencia", id)).isFalse();
        assertThat(pagos.findById(pago.getId())).isPresent(); assertThat(compras.findById(compra.getId())).isPresent();
        // Reusar la clave purgada no inicia otro cobro: se mantiene el pago único por compra.
        assertThatThrownBy(() -> simulacion.simular(compra.getUsuarioId(), compra.getId(), clave, EscenarioPago.APROBAR))
                .hasMessageContaining("ya tiene un pago");

        UUID pendiente = guardar(new RegistroIdempotencia(compra.getUsuarioId(), "POST", ruta, UUID.randomUUID(), "b".repeat(64), 201, "{}", null));
        jdbc.update("UPDATE pagos SET estado='PENDIENTE' WHERE id=?", pago.getId());
        job(100).limpiar(); assertThat(existe("idempotencia", pendiente)).isTrue();
        assertThat(jdbc.queryForObject("SELECT completed_at FROM idempotencia WHERE id=?", java.sql.Timestamp.class, pendiente)).isNull();
        jdbc.update("UPDATE pagos SET estado='REQUIERE_CONCILIACION' WHERE id=?", pago.getId());
        jdbc.update("UPDATE idempotencia SET completed_at=? WHERE id=?", utc(CORTE.minusSeconds(1)), pendiente);
        job(100).limpiar(); assertThat(existe("idempotencia", pendiente)).isTrue();
    }

    @Test
    void conservaRevisionReferenciadaYDiarioQueRespaldaReservas() {
        var orden = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Central", EstadoOrden.PENDIENTE_PAGO,
                List.of(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Café", 1, new BigDecimal("1000"))));
        var compra = compras.saveAndFlush(new Compra(UUID.randomUUID(), AHORA, List.of(orden)));
        UUID revision = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO revisiones_compra(id,compra_id,usuario_id,accion,ruta,clave,plan,fase,status,respuesta,trace_id,created_at,updated_at,completed_at)
            VALUES(?,?,?,'CONFIRMAR',?,?,'{}','TERMINADA',200,'{}',?,?,?,?)
            """, revision, compra.getId(), compra.getUsuarioId(), "/compras/" + compra.getId() + "/confirmar", UUID.randomUUID(),
                "a".repeat(32), utc(CORTE.minusSeconds(1)), utc(CORTE.minusSeconds(1)), utc(CORTE.minusSeconds(1)));
        jdbc.update("UPDATE compras SET revision_pendiente=? WHERE id=?", revision, compra.getId());
        UUID creacion = creacion("TERMINADA", CORTE.minusSeconds(1));
        UUID reserva = UUID.randomUUID();
        jdbc.update("INSERT INTO orden_reservas(orden_id,oferta_id,reserva_id,intento_id) VALUES(?,?,?,?)",
                orden.getId(), orden.getItems().getFirst().getOfertaId(), reserva, creacion);
        job(100).limpiar();
        assertThat(existe("revisiones_compra", revision)).isTrue(); assertThat(existe("creacion_compras", creacion)).isTrue();
        jdbc.update("UPDATE compras SET revision_pendiente=NULL WHERE id=?", compra.getId());
        jdbc.update("DELETE FROM orden_reservas WHERE reserva_id=?", reserva);
        job(100).limpiar();
        assertThat(existe("revisiones_compra", revision)).isFalse(); assertThat(existe("creacion_compras", creacion)).isFalse();
    }

    @Test
    void workerSaltaFilasBloqueadasSinBorrarlasDuranteReplay() throws Exception {
        UUID id = creacion("TERMINADA", CORTE.minusSeconds(30));
        try (var executor = Executors.newSingleThreadExecutor()) {
            new TransactionTemplate(manager).executeWithoutResult(status -> {
                jdbc.queryForObject("SELECT id FROM creacion_compras WHERE id=? FOR UPDATE", UUID.class, id);
                try { executor.submit(() -> job(100).limpiar()).get(5, TimeUnit.SECONDS); }
                catch (Exception e) { throw new RuntimeException(e); }
                assertThat(existe("creacion_compras", id)).isTrue();
            });
        }
        job(100).limpiar(); assertThat(existe("creacion_compras", id)).isFalse();
    }

    @Test
    void validaMinimo24HorasYTamanioDeLote() {
        assertThatThrownBy(() -> new RetencionIdempotencias(jdbc, Clock.systemUTC(), manager, Duration.ofHours(23), 100)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> job(0)).isInstanceOf(IllegalArgumentException.class);
        assertThatCode(() -> new RetencionIdempotencias(jdbc, Clock.systemUTC(), manager, Duration.ofHours(24), 1)).doesNotThrowAnyException();
    }

    private UUID guardar(RegistroIdempotencia r) {
        return idempotencias.saveAndFlush(r).getId();
    }
    private UUID creacion(String fase, Instant terminada) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO creacion_compras(id,usuario_id,clave,hash_cuerpo,solicitud,fase,respuesta,status,trace_id,created_at,updated_at,completed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """, id, UUID.randomUUID(), UUID.randomUUID(), "a".repeat(64), "[]", fase,
                fase.equals("TERMINADA") ? "{}" : null, fase.equals("TERMINADA") ? 409 : null,
                "a".repeat(32), utc(terminada), utc(terminada), fase.equals("TERMINADA") ? utc(terminada) : null);
        return id;
    }
    private boolean existe(String tabla, UUID id) { return jdbc.queryForObject("SELECT count(*) FROM " + tabla + " WHERE id=?", Long.class, id) == 1; }
}
