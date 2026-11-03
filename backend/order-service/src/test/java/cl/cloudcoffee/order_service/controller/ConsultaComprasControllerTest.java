package cl.cloudcoffee.order_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cl.cloudcoffee.order_service.model.*;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import jakarta.persistence.EntityManagerFactory;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** HTTP, JWT firmado y persistencia real; también se ejecuta contra PostgreSQL en CI. */
@SpringBootTest(properties = {
        "management.tracing.enabled=false", "spring.jpa.open-in-view=false",
        "spring.jpa.properties.hibernate.generate_statistics=true",
        "spring.jpa.properties.hibernate.query.fail_on_pagination_over_collection_fetch=true"})
@AutoConfigureMockMvc
class ConsultaComprasControllerTest extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManagerFactory entityManagerFactory;

    final UUID cliente = UUID.randomUUID();
    static final Instant FECHA = Instant.parse("2026-10-01T12:00:00Z");

    @Test
    void consultaCompraConDosCafeteriasSnapshotsYCamposDelContrato() throws Exception {
        Compra compra = compra(cliente, FECHA);
        Orden orden = compra.getOrdenes().getFirst();
        OrdenItem item = orden.getItems().getFirst();

        consultar("/compras/" + compra.getId())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.length()").value(11))
                .andExpect(jsonPath("$.compraId").value(compra.getId().toString()))
                .andExpect(jsonPath("$.clienteId").value(cliente.toString()))
                .andExpect(jsonPath("$.estado").value("revision_requerida"))
                .andExpect(jsonPath("$.montoTotal").value(4500))
                .andExpect(jsonPath("$.moneda").value("CLP"))
                .andExpect(jsonPath("$.ordenes.length()").value(2))
                .andExpect(jsonPath("$.pago").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.creadoAt").value(FECHA.toString()))
                .andExpect(jsonPath("$.actualizadoAt").value(FECHA.toString()))
                .andExpect(jsonPath("$.reservaExpiraAt").value(FECHA.plusSeconds(900).toString()))
                .andExpect(jsonPath("$.version").value(1));

        consultar("/orders/" + orden.getId())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.length()").value(15))
                .andExpect(jsonPath("$.ordenId").value(orden.getId().toString()))
                .andExpect(jsonPath("$.compraId").value(compra.getId().toString()))
                .andExpect(jsonPath("$.codigoOrden").value(orden.getCodigoOrden()))
                .andExpect(jsonPath("$.cafeteriaId").value(orden.getCafeteriaId().toString()))
                .andExpect(jsonPath("$.cafeteriaNombre").value("Central histórica"))
                .andExpect(jsonPath("$.estado").value("pendiente_pago"))
                .andExpect(jsonPath("$.montoTotal").value(3600))
                .andExpect(jsonPath("$.moneda").value("CLP"))
                .andExpect(jsonPath("$.retiroHasta").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.entregadoAt").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.creadoAt").value(FECHA.toString()))
                .andExpect(jsonPath("$.actualizadoAt").value(FECHA.toString()))
                .andExpect(jsonPath("$.reservaExpiraAt").value(FECHA.plusSeconds(900).toString()))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].length()").value(7))
                .andExpect(jsonPath("$.items[0].ordenItemId").value(item.getId().toString()))
                .andExpect(jsonPath("$.items[0].ofertaId").value(item.getOfertaId().toString()))
                .andExpect(jsonPath("$.items[0].productoId").value(item.getProductoId().toString()))
                .andExpect(jsonPath("$.items[0].productoNombre").value("Café histórico"))
                .andExpect(jsonPath("$.items[0].cantidad").value(2))
                .andExpect(jsonPath("$.items[0].precioUnitario").value(1800))
                .andExpect(jsonPath("$.items[0].subtotal").value(3600));
    }

    @Test
    void paginaSoloComprasPropiasConDesempatePorIdYConteoCorrecto() throws Exception {
        Compra anterior = compra(cliente, FECHA.minusSeconds(1));
        Compra primera = compra(cliente, FECHA);
        Compra segunda = compra(cliente, FECHA);
        compra(UUID.randomUUID(), FECHA.plusSeconds(60));
        List<String> ids = new ArrayList<>(List.of(primera.getId().toString(), segunda.getId().toString()));
        ids.sort(java.util.Comparator.reverseOrder());

        // Parámetros extra no permiten ampliar el acceso ni cambiar el orden fijo.
        consultar("/compras?page=0&size=2&clienteId=" + UUID.randomUUID() + "&sort=createdAt,asc")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.length()").value(8))
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].compraId").value(ids.get(0)))
                .andExpect(jsonPath("$.content[1].compraId").value(ids.get(1)))
                .andExpect(jsonPath("$.content[0].ordenes.length()").value(2))
                .andExpect(jsonPath("$.number").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.first").value(true))
                .andExpect(jsonPath("$.last").value(false))
                .andExpect(jsonPath("$.empty").value(false));

        consultar("/compras?page=1&size=2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].compraId").value(anterior.getId().toString()))
                .andExpect(jsonPath("$.first").value(false))
                .andExpect(jsonPath("$.last").value(true));

        consultar("/compras?page=8&size=2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.number").value(8))
                .andExpect(jsonPath("$.last").value(true))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @Test
    void sinComprasDevuelvePaginaVaciaConPredeterminados() throws Exception {
        compra(UUID.randomUUID(), FECHA);
        consultar("/compras")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.number").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.totalPages").value(0))
                .andExpect(jsonPath("$.first").value(true))
                .andExpect(jsonPath("$.last").value(true))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @Test
    void unaPaginaMuyLejanaSigueSiendoUnaPaginaVacia() throws Exception {
        compra(cliente, FECHA);
        consultar("/compras?page=2147483647&size=100")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.number").value(Integer.MAX_VALUE))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.totalPages").value(1))
                .andExpect(jsonPath("$.last").value(true));
    }

    @Test
    void incluyePagoActualYConservaOrdenesCanceladasSinEfectosDeLectura() throws Exception {
        Compra compra = compra(cliente, FECHA);
        Orden orden = compra.getOrdenes().getFirst();
        Pago pago = new Pago(compra, "SIMULADO", null);
        pago.aplicarResultado(EstadoPago.RECHAZADO, "Rechazo de prueba");
        pago.registrarMotivo(MotivoPago.RECHAZO_SIMULADO);
        pagos.saveAndFlush(pago);
        jdbc.update("UPDATE compras SET estado='CANCELADO', monto_total=0, version=3 WHERE id=?", compra.getId());
        jdbc.update("UPDATE ordenes SET estado='CANCELADO', version=2 WHERE compra_id=?", compra.getId());
        var compraAntes = jdbc.queryForMap("SELECT * FROM compras WHERE id=?", compra.getId());
        var pagoAntes = jdbc.queryForMap("SELECT * FROM pagos WHERE compra_id=?", compra.getId());
        var ordenAntes = jdbc.queryForMap("SELECT * FROM ordenes WHERE id=?", orden.getId());

        for (int i = 0; i < 2; i++) {
            consultar("/compras/" + compra.getId())
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.estado").value("cancelado"))
                    .andExpect(jsonPath("$.montoTotal").value(0))
                    .andExpect(jsonPath("$.version").value(4))
                    .andExpect(jsonPath("$.ordenes.length()").value(2))
                    .andExpect(jsonPath("$.ordenes[0].estado").value("cancelado"))
                    .andExpect(jsonPath("$.ordenes[0].version").value(3))
                    .andExpect(jsonPath("$.pago.pagoId").value(pago.getId().toString()))
                    .andExpect(jsonPath("$.pago.estado").value("rechazado"))
                    .andExpect(jsonPath("$.pago.motivo").value("rechazo_simulado"))
                    .andExpect(jsonPath("$.pago.montoTotal").value(4500));
            consultar("/compras").andExpect(jsonPath("$.content[0].pago.pagoId").value(pago.getId().toString()));
            consultar("/orders/" + orden.getId()).andExpect(jsonPath("$.montoTotal").value(3600));
        }
        assertThat(jdbc.queryForMap("SELECT * FROM compras WHERE id=?", compra.getId())).isEqualTo(compraAntes);
        assertThat(jdbc.queryForMap("SELECT * FROM pagos WHERE compra_id=?", compra.getId())).isEqualTo(pagoAntes);
        assertThat(jdbc.queryForMap("SELECT * FROM ordenes WHERE id=?", orden.getId())).isEqualTo(ordenAntes);
    }

    @Test
    void comprasAnterioresAV4NoInventanOrdenes() throws Exception {
        Compra historica = compras.saveAndFlush(new Compra(cliente, new BigDecimal("3700")));
        consultar("/compras/" + historica.getId())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ordenes").isEmpty())
                .andExpect(jsonPath("$.montoTotal").value(3700));
    }

    @Test
    void recursosAjenosEInexistentesRespondenElMismoProblema() throws Exception {
        Compra ajena = compra(UUID.randomUUID(), FECHA);
        for (String id : List.of(ajena.getId().toString(), UUID.randomUUID().toString())) {
            consultar("/compras/" + id).andExpect(status().isNotFound())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                    .andExpect(jsonPath("$.code").value("COMPRA_NO_ENCONTRADA"))
                    .andExpect(jsonPath("$.detail").value("No existe una compra con el identificador indicado."))
                    .andExpect(jsonPath("$.instance").value("/compras/" + id))
                    .andExpect(jsonPath("$.timestamp").isNotEmpty());
        }
        for (UUID id : List.of(ajena.getOrdenes().getFirst().getId(), UUID.randomUUID())) {
            consultar("/orders/" + id).andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("ORDEN_NO_ENCONTRADA"))
                    .andExpect(jsonPath("$.detail").value("No existe una orden con el identificador indicado."));
        }
    }

    @ParameterizedTest
    @CsvSource({"-1,20", "0,0", "0,-1", "0,101"})
    void validaLimitesDePaginacion(int page, int size) throws Exception {
        consultar("/compras?page=" + page + "&size=" + size)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PAGINACION_INVALIDA"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/compras?page=abc", "/compras?size=abc", "/compras?page=2147483648",
            "/compras/no-es-uuid", "/orders/no-es-uuid"})
    void parametrosMalformadosSon400(String ruta) throws Exception {
        consultar(ruta).andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void otrosRolesNoHeredanPermisosDelComprador(String rol) throws Exception {
        Compra compra = compra(cliente, FECHA);
        String jwt = bearer(cliente.toString(), rol);
        for (String ruta : rutas(compra)) {
            mvc.perform(get(ruta).header("Authorization", jwt))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
        }
    }

    @Test
    void subjectNoUuidNoPermiteLeerDatos() throws Exception {
        mvc.perform(get("/compras").header("Authorization", bearer("no-es-uuid", "CLIENTE")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("USUARIO_INVALIDO"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"expired", "tampered", "wrong-key", "malformed"})
    void jwtAusenteOInvalidoNoPermiteNingunaLectura(String tipo) throws Exception {
        Compra compra = compra(cliente, FECHA);
        for (String ruta : rutas(compra)) {
            mvc.perform(get(ruta)).andExpect(status().isUnauthorized());
            mvc.perform(get(ruta).header("Authorization", "Bearer " + invalidToken(tipo)))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void paginaCompletaCargaColeccionesYPagosEnLotesSinConsultasPorCompra() throws Exception {
        for (int i = 0; i < 4; i++) {
            Compra compra = compra(cliente, FECHA.plusSeconds(i));
            pagos.saveAndFlush(new Pago(compra, "SIMULADO", null));
        }
        var stats = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        stats.clear();
        consultar("/compras?size=3").andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.content[2].ordenes.length()").value(2))
                .andExpect(jsonPath("$.content[2].pago.pagoId").isNotEmpty());
        assertThat(stats.getPrepareStatementCount()).isLessThanOrEqualTo(4);
    }

    private Compra compra(UUID dueno, Instant fecha) {
        Orden central = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Central histórica",
                EstadoOrden.PENDIENTE_PAGO,
                List.of(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Café histórico", 2, new BigDecimal("1800"))));
        Orden norte = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Norte histórica",
                EstadoOrden.REVISION_REQUERIDA,
                List.of(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Té", 1, new BigDecimal("900"))));
        return compras.saveAndFlush(new Compra(dueno, fecha, List.of(central, norte)));
    }

    private ResultActions consultar(String ruta) throws Exception {
        return mvc.perform(get(ruta).header("Authorization", bearer(cliente.toString(), "CLIENTE")));
    }

    private List<String> rutas(Compra compra) {
        return List.of("/compras", "/compras/" + compra.getId(), "/orders/" + compra.getOrdenes().getFirst().getId());
    }

    private static String bearer(String usuario, String rol) {
        return "Bearer " + sign(claims().subject(usuario).claim("role", rol).build(), KEYS, JWSAlgorithm.RS256);
    }
}
