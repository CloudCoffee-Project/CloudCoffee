package cl.cloudcoffee.order_service.service;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import cl.cloudcoffee.order_service.dto.QrRetiroResponse;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Orden;
import cl.cloudcoffee.order_service.model.RegistroIdempotencia;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.OrdenRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.repository.RegistroIdempotenciaRepository;
import cl.cloudcoffee.order_service.revision.EventosRevision;
import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import jakarta.persistence.EntityManager;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class RetiroService {
    // SHA-256 del cuerpo vacío: /listo no admite datos de estado, plazo ni credencial del cliente.
    private static final String HASH_SIN_CUERPO = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    private final CompraRepository compras;
    private final OrdenRepository ordenes;
    private final PagoRepository pagos;
    private final RegistroIdempotenciaRepository idempotencia;
    private final AsignacionesCafeteria asignaciones;
    private final CredencialesRetiro credenciales;
    private final EventosRevision eventos;
    private final JdbcTemplate jdbc;
    private final EntityManager em;
    private final JsonMapper json;
    private final Clock clock;

    public RetiroService(CompraRepository compras, OrdenRepository ordenes, PagoRepository pagos,
            RegistroIdempotenciaRepository idempotencia, AsignacionesCafeteria asignaciones,
            CredencialesRetiro credenciales, EventosRevision eventos, JdbcTemplate jdbc, EntityManager em,
            JsonMapper json, Clock clock) {
        this.compras = compras;
        this.ordenes = ordenes;
        this.pagos = pagos;
        this.idempotencia = idempotencia;
        this.asignaciones = asignaciones;
        this.credenciales = credenciales;
        this.eventos = eventos;
        this.jdbc = jdbc;
        this.em = em;
        this.json = json;
        this.clock = clock;
    }

    public record Respuesta(int status, String cuerpo, boolean replay) {}

    @Transactional
    public Respuesta preparar(UUID cajeroId, UUID ordenId, UUID clave) {
        UUID cafeteria = cafeteriaAsignada(cajeroId);
        var ids = jdbc.queryForList("SELECT compra_id FROM ordenes WHERE id=? AND cafeteria_id=?",
                UUID.class, ordenId, cafeteria);
        if (ids.isEmpty()) throw noEncontrada();
        // Mismo bloqueo que pago y cancelación. Acceso verificado antes de leer el resultado idempotente.
        var compra = compras.findForUpdate(ids.getFirst()).orElseThrow(RetiroService::noEncontrada);
        var orden = ordenes.findConItemsByIdAndPropietario(ordenId, compra.getUsuarioId()).orElseThrow(RetiroService::noEncontrada);
        String ruta = "/orders/" + ordenId + "/listo";
        var previo = idempotencia.findByUsuarioIdAndMetodoAndRutaAndClave(cajeroId, "POST", ruta, clave);
        if (previo.isPresent()) {
            var registro = previo.get();
            return new Respuesta(registro.getStatus(), registro.getCuerpo(), true);
        }

        Instant ahora = clock.instant().truncatedTo(ChronoUnit.MICROS);
        try {
            validar(orden, EstadoOrden.PAGADO, ahora);
        } catch (BusinessException invalid) {
            String cuerpo = json.writeValueAsString(Map.of(
                    "type", invalid.getType(), "title", invalid.getTitle(), "status", invalid.getStatus().value(),
                    "detail", invalid.getMessage(), "code", invalid.getCode(), "instance", ruta,
                    "timestamp", ahora, "traceId", ResultadoPagoService.trace()));
            return guardar(cajeroId, clave, ruta, invalid.getStatus().value(), cuerpo, ahora);
        }

        var anterior = OrdenResponse.from(orden);
        var credencial = credenciales.emitir(ordenId);
        jdbc.update("""
                INSERT INTO orden_retiros (orden_id, codigo_hash, codigo_cifrado, preparado_por, preparado_at)
                VALUES (?, ?, ?, ?, ?)
                """, ordenId, credencial.hash(), credencial.cifrado(), cajeroId, utc(ahora));
        int cambiadas = jdbc.update("""
                UPDATE ordenes SET estado='LISTO_PARA_RETIRO', version=version+1, updated_at=?
                WHERE id=? AND estado='PAGADO'
                """, utc(ahora), ordenId);
        if (cambiadas != 1) throw new IllegalStateException("La orden cambió durante la preparación.");
        em.clear();
        var actual = OrdenResponse.from(ordenes.findConItemsByIdAndPropietario(ordenId, compra.getUsuarioId()).orElseThrow());
        eventos.orden(anterior, actual, compra.getUsuarioId(), ResultadoPagoService.trace(), ahora);
        return guardar(cajeroId, clave, ruta, 200, json.writeValueAsString(actual), ahora);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public QrRetiroResponse consultar(UUID usuarioId, String rol, UUID ordenId) {
        Orden orden;
        if ("CLIENTE".equals(rol)) {
            orden = ordenes.findConItemsByIdAndPropietario(ordenId, usuarioId).orElseThrow(RetiroService::noEncontrada);
        } else {
            UUID cafeteria = cafeteriaAsignada(usuarioId);
            var encontradas = ordenes.findConItemsByIdsAndCafeteria(List.of(ordenId), cafeteria);
            if (encontradas.isEmpty()) throw noEncontrada();
            orden = encontradas.getFirst();
        }
        validar(orden, EstadoOrden.LISTO_PARA_RETIRO, clock.instant());
        var cifrados = jdbc.queryForList("SELECT codigo_cifrado FROM orden_retiros WHERE orden_id=?", String.class, ordenId);
        if (cifrados.isEmpty()) throw estadoInvalido();
        return new QrRetiroResponse(ordenId, credenciales.recuperar(ordenId, cifrados.getFirst()), orden.getRetiroHasta());
    }

    private void validar(Orden orden, EstadoOrden requerido, Instant ahora) {
        if (orden.getEstado() == EstadoOrden.ENTREGADO) {
            throw error(HttpStatus.CONFLICT, "QR_UTILIZADO", "La orden ya fue entregada.");
        }
        if (orden.getEstado() == EstadoOrden.NO_RETIRADO_PENDIENTE_REVISION
                || orden.getEstado() == EstadoOrden.NO_RETIRADO_FINAL) {
            throw error(HttpStatus.CONFLICT, "QR_VENCIDO", "El plazo de retiro terminó.");
        }
        if (orden.getEstado() != requerido || orden.getCompra().getEstado() != EstadoCompra.PAGADO
                || pagos.findByCompraId(orden.getCompra().getId()).filter(p -> p.getEstado() == EstadoPago.APROBADO).isEmpty()
                || orden.getRetiroHasta() == null || orden.getItems().isEmpty()) {
            throw estadoInvalido();
        }
        // PAGADO es la decisión canónica posterior a confirmar todas las reservas. Exigir su trazabilidad.
        int sinReserva = jdbc.queryForObject("""
                SELECT COUNT(*) FROM orden_items i WHERE i.orden_id=? AND NOT EXISTS (
                    SELECT 1 FROM orden_reservas r WHERE r.orden_id=i.orden_id AND r.oferta_id=i.oferta_id)
                """, Integer.class, orden.getId());
        if (sinReserva != 0) throw estadoInvalido();
        if (!ahora.isBefore(orden.getRetiroHasta())) {
            throw error(HttpStatus.CONFLICT, "QR_VENCIDO", "El plazo de retiro terminó.");
        }
    }

    private Respuesta guardar(UUID usuario, UUID clave, String ruta, int status, String cuerpo, Instant ahora) {
        var registro = new RegistroIdempotencia(usuario, "POST", ruta, clave, HASH_SIN_CUERPO, status, cuerpo, null);
        registro.completar(ahora);
        idempotencia.save(registro);
        return new Respuesta(status, cuerpo, false);
    }

    private UUID cafeteriaAsignada(UUID cajero) {
        try {
            return asignaciones.cafeteriaDe(cajero).orElseThrow(RetiroService::sinAsignacion);
        } catch (AsignacionNoVerificableException exception) {
            throw sinAsignacion();
        }
    }

    private static BusinessException sinAsignacion() {
        return error(HttpStatus.FORBIDDEN, "ASIGNACION_NO_AUTORIZADA", "Se requiere una cafetería asignada y verificable en Auth.");
    }

    private static BusinessException noEncontrada() {
        return error(HttpStatus.NOT_FOUND, "ORDEN_NO_ENCONTRADA", "No existe una orden accesible con ese identificador.");
    }

    private static BusinessException estadoInvalido() {
        return error(HttpStatus.CONFLICT, "ESTADO_INVALIDO", "La operación requiere pago y stock confirmados y un estado compatible.");
    }

    private static BusinessException error(HttpStatus status, String code, String detail) {
        return new BusinessException(status, URI.create("/problems/" + code.toLowerCase(java.util.Locale.ROOT).replace('_', '-')),
                "No se pudo completar el retiro", detail, code);
    }
}
