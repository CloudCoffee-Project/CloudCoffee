package cl.cloudcoffee.order_service.revision;

import cl.cloudcoffee.order_service.creacion.CatalogoCompras;
import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import cl.cloudcoffee.order_service.service.ConsultaComprasService;
import jakarta.persistence.EntityManager;
import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.slf4j.MDC;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** INT2-73: decisiones del comprador anteriores a cualquier pago iniciado. */
@Service
public class RevisionCompraService {
    private final DiarioRevision diario;
    private final CatalogoCompras catalogo;
    private final ConsultaComprasService consultas;
    private final EventosRevision eventos;
    private final EntityManager em;
    private final Clock clock;
    private final TransactionTemplate tx;

    public RevisionCompraService(DiarioRevision diario, CatalogoCompras catalogo, ConsultaComprasService consultas,
            EventosRevision eventos, EntityManager em, Clock clock, PlatformTransactionManager manager) {
        this.diario = diario; this.catalogo = catalogo; this.consultas = consultas; this.eventos = eventos;
        this.em = em; this.clock = clock; this.tx = new TransactionTemplate(manager);
    }
    public record Respuesta(int status, String cuerpo, boolean replay, boolean reintentar) {}
    private record Inicio(UUID id, boolean replay, Respuesta respuesta) {}

    public Respuesta ejecutar(UUID usuario, UUID recurso, boolean porOrden, boolean confirmar, UUID clave) {
        String ruta = (porOrden ? "/orders/" : "/compras/") + recurso + (confirmar ? "/confirmar" : "/cancelar");
        Inicio inicio;
        try { inicio = tx.execute(status -> iniciar(usuario, recurso, porOrden, confirmar, clave)); }
        catch (PessimisticLockingFailureException | QueryTimeoutException ocupada) {
            return problema(409, "IDEMPOTENCY_IN_PROGRESS", "La compra tiene una operación en curso.", trace(), ruta, null, true);
        }
        if (inicio.respuesta() != null) return inicio.respuesta();
        for (int paso = 0; paso < 500; paso++) {
            Respuesta respuesta;
            try { respuesta = avanzar(inicio.id()); }
            catch (PessimisticLockingFailureException | QueryTimeoutException ocupada) {
                return problema(409, "IDEMPOTENCY_IN_PROGRESS", "La compra tiene una operación en curso.", trace(), ruta, null, true);
            }
            if (respuesta != null) return new Respuesta(respuesta.status(), respuesta.cuerpo(),
                    inicio.replay() && !respuesta.reintentar(), respuesta.reintentar());
        }
        return problema(409, "IDEMPOTENCY_IN_PROGRESS", "La operación continúa; reintenta con la misma clave.", trace(), ruta, null, true);
    }

    private Inicio iniciar(UUID usuario, UUID recurso, boolean porOrden, boolean confirmar, UUID clave) {
        UUID compraId = porOrden ? diario.compraDeOrden(recurso) : recurso;
        // Comprobar propiedad antes del intento NOWAIT evita revelar recursos ajenos incluso bajo contención.
        var duenos = diario.jdbc().queryForList("SELECT usuario_id FROM compras WHERE id=?", UUID.class, compraId);
        if (duenos.isEmpty() || !duenos.getFirst().equals(usuario)) throw DiarioRevision.noEncontrada(porOrden);
        String accion = confirmar ? "CONFIRMAR" : "CANCELAR";
        String ruta = (porOrden ? "/orders/" : "/compras/") + recurso + "/" + accion.toLowerCase(Locale.ROOT);
        var previos = diario.previos(usuario, ruta, clave);
        if (!previos.isEmpty()) return new Inicio(previos.getFirst(), true, null);
        var bloqueo = diario.bloquear(compraId);
        if (bloqueo == null || !usuario.equals(bloqueo.usuario())) throw DiarioRevision.noEncontrada(porOrden);
        // Otro request pudo registrar esta misma intención mientras esperábamos el bloqueo.
        previos = diario.previos(usuario, ruta, clave);
        if (!previos.isEmpty()) return new Inicio(previos.getFirst(), true, null);
        if (bloqueo.pendiente() != null) return new Inicio(null, false,
                problema(409, "IDEMPOTENCY_IN_PROGRESS", "La compra tiene una operación en curso.", trace(), ruta, null, true));

        em.clear();
        CompraResponse compra = consultas.compra(usuario, compraId);
        var plan = new PlanRevision(); plan.compra = compra;
        plan.paso = confirmar ? "COTIZAR" : "LIBERAR";
        List<OrdenResponse> objetivos = compra.ordenes().stream()
                .filter(o -> porOrden ? o.ordenId().equals(recurso)
                        : confirmar ? o.estado().equals("revision_requerida") : !o.estado().equals("cancelado"))
                .toList();
        for (OrdenResponse orden : objetivos) {
            var grupo = new PlanRevision.Grupo(); grupo.anterior = orden;
            for (var item : orden.items()) {
                var linea = new PlanRevision.Linea(); linea.anterior = item;
                if (!confirmar) {
                    var reservas = diario.jdbc().queryForList("SELECT reserva_id FROM orden_reservas WHERE orden_id=? AND oferta_id=?",
                            UUID.class, orden.ordenId(), item.ofertaId());
                    if (!reservas.isEmpty()) { linea.reservaId = reservas.getFirst(); linea.solicitada = true; }
                }
                grupo.items.add(linea);
            }
            plan.grupos.add(grupo);
        }
        UUID id = UUID.randomUUID();
        diario.insertar(id, compraId, usuario, porOrden ? recurso : null, accion, ruta, clave, plan, trace(), ahora());
        var registro = diario.buscar(id);
        boolean estadoValido = Set.of("revision_requerida", "pendiente_pago").contains(compra.estado())
                && compra.pago() == null
                && (!objetivos.isEmpty() || !confirmar && !porOrden && compra.ordenes().isEmpty())
                && objetivos.stream().allMatch(o -> confirmar ? o.estado().equals("revision_requerida")
                        : Set.of("revision_requerida", "pendiente_pago").contains(o.estado()));
        if (!estadoValido) terminarError(registro, 409, "ESTADO_INVALIDO",
                "La acción requiere una compra sin pago iniciado y estados compatibles.", null);
        else diario.jdbc().update("UPDATE compras SET revision_pendiente=? WHERE id=?", id, compraId);
        return new Inicio(id, false, null);
    }

    /** El mismo bloqueo de compra ordena todos los comandos; la marca durable protege entre pasos. */
    public Respuesta avanzar(UUID id) {
        return tx.execute(status -> {
            var r = diario.buscar(id);
            if (r.fase().equals("TERMINADA")) return new Respuesta(r.status(), r.respuesta(), true, false);
            diario.bloquear(r.compraId());
            r = diario.buscar(id);
            if (r.fase().equals("TERMINADA")) return new Respuesta(r.status(), r.respuesta(), true, false);
            var plan = diario.json().readValue(r.plan(), PlanRevision.class);
            try {
                if (r.accion().equals("CONFIRMAR") && Set.of("COTIZAR", "RESERVAR").contains(plan.paso)
                        && !clock.instant().isBefore(plan.compra.reservaExpiraAt())) {
                    plan.fallo = "RESERVA_VENCIDA"; plan.paso = "COMPENSAR";
                    diario.plan(id, plan, ahora()); return null;
                }
                if (plan.paso.equals("COTIZAR")) return cotizar(r, plan, false);
                if (plan.paso.equals("RESERVAR")) {
                    for (var grupo : plan.grupos) for (var item : grupo.items) {
                        if (item.reservaId != null) continue;
                        if (!item.solicitada) { item.solicitada = true; diario.plan(id, plan, ahora()); return null; }
                        try {
                            var reserva = reservar(r, plan, grupo, item);
                            item.reservaId = reserva.reservationId();
                            if (!reserva.status().equals("RESERVED")) {
                                plan.fallo = "RESERVA_VENCIDA"; plan.paso = "COMPENSAR";
                            }
                        } catch (CatalogoCompras.Rechazo rechazo) {
                            item.liberada = true;
                            plan.fallo = rechazo.code.equals("STOCK_NO_DISPONIBLE") ? "STOCK_INSUFICIENTE" : rechazo.code;
                            plan.paso = "COMPENSAR";
                        }
                        diario.plan(id, plan, ahora()); return null;
                    }
                    return completar(r, plan, false);
                }
                if (Set.of("LIBERAR", "COMPENSAR").contains(plan.paso)) {
                    for (var grupo : plan.grupos) for (var item : grupo.items) {
                        if (!item.solicitada || item.liberada) continue;
                        if (item.reservaId == null) {
                            try { item.reservaId = reservar(r, plan, grupo, item).reservationId(); }
                            catch (CatalogoCompras.Rechazo noReservada) { item.liberada = true; }
                            diario.plan(id, plan, ahora()); return null;
                        }
                        catalogo.liberar(item.reservaId);
                        item.liberada = true; diario.plan(id, plan, ahora()); return null;
                    }
                    if (plan.paso.equals("COMPENSAR")) {
                        // Catalog usa el mismo rechazo para precio y actividad. Tras compensar,
                        // una nueva lectura permite devolver PRECIO_CAMBIO con la cotización revisada.
                        if (plan.fallo.equals("OFERTA_NO_DISPONIBLE")) return cotizar(r, plan, true);
                        return terminarError(r, 409, plan.fallo,
                                "No se pudo confirmar; se liberaron solo las reservas nuevas de este intento.", null);
                    }
                    return completar(r, plan, false);
                }
                throw new IllegalStateException("Paso de revisión desconocido");
            } catch (CatalogoCompras.NoDisponible unavailable) {
                diario.jdbc().update("UPDATE revisiones_compra SET updated_at=? WHERE id=?", utc(ahora()), id);
                return problema(503, "OPERACION_PENDIENTE", "No se pudo completar la operación; reintenta con la misma clave.", r.trace(), r.ruta(), null, true);
            }
        });
    }

    private Respuesta cotizar(DiarioRevision.Registro r, PlanRevision plan, boolean trasCompensar) {
        var ids = plan.grupos.stream().flatMap(g -> g.items.stream()).map(i -> i.anterior.ofertaId()).toList();
        List<CatalogoCompras.Oferta> ofertas;
        try { ofertas = catalogo.cotizar(ids); }
        catch (CatalogoCompras.Rechazo rechazo) {
            return terminarError(r, 409, rechazo.code, "Las ofertas ya no están disponibles para confirmar.", null);
        }
        var porId = new HashMap<UUID, CatalogoCompras.Oferta>();
        for (var oferta : ofertas) {
            if (oferta == null || oferta.ofertaId() == null || oferta.precioUnitario() == null
                    || oferta.productoId() == null || oferta.productoNombre() == null || oferta.cafeteriaId() == null
                    || oferta.cafeteriaNombre() == null || oferta.campusId() == null) throw new CatalogoCompras.NoDisponible();
            porId.put(oferta.ofertaId(), oferta);
        }
        if (porId.size() != ids.size() || ids.stream().anyMatch(id -> !porId.containsKey(id))) throw new CatalogoCompras.NoDisponible();
        if (ofertas.stream().map(CatalogoCompras.Oferta::campusId).distinct().count() != 1)
            return terminarError(r, 409, "OFERTA_NO_DISPONIBLE", "Las ofertas deben pertenecer al mismo campus.", null);
        boolean precioCambio = false;
        long total = plan.compra.montoTotal();
        try {
            for (var grupo : plan.grupos) {
                total = Math.subtractExact(total, grupo.anterior.montoTotal());
                for (var item : grupo.items) {
                    item.cotizacion = porId.get(item.anterior.ofertaId());
                    if (!grupo.anterior.cafeteriaId().equals(item.cotizacion.cafeteriaId()))
                        return terminarError(r, 409, "OFERTA_NO_DISPONIBLE", "Cambió la cafetería de una oferta.", null);
                    long precio = item.cotizacion.precioUnitario().longValueExact();
                    if (precio < 0 || precio > 2_000_000_000L) throw new ArithmeticException();
                    precioCambio |= precio != item.anterior.precioUnitario();
                    total = Math.addExact(total, Math.multiplyExact(precio, item.anterior.cantidad()));
                }
            }
            if (total < 0 || total > 2_000_000_000L) throw new ArithmeticException();
        } catch (ArithmeticException invalido) {
            return terminarError(r, 400, "MONTO_INVALIDO", "El total debe ser entero en CLP y no superar 2.000.000.000.", null);
        }
        if (precioCambio) return completar(r, plan, true);
        if (trasCompensar) return terminarError(r, 409, "OFERTA_NO_DISPONIBLE",
                "La oferta cambió durante la reserva; consulta su disponibilidad antes de volver a confirmar.", null);
        plan.paso = "RESERVAR"; diario.plan(r.id(), plan, ahora()); return null;
    }

    private CatalogoCompras.Reserva reservar(DiarioRevision.Registro r, PlanRevision plan,
            PlanRevision.Grupo grupo, PlanRevision.Linea item) {
        return catalogo.reservar(grupo.anterior.ordenId(), item.anterior.ofertaId(), item.anterior.cantidad(),
                r.id(), plan.compra.reservaExpiraAt(), item.cotizacion.precioUnitario());
    }

    private Respuesta completar(DiarioRevision.Registro r, PlanRevision plan, boolean soloCotizacion) {
        Instant ahora = ahora();
        boolean confirmar = r.accion().equals("CONFIRMAR");
        for (var grupo : plan.grupos) {
            long total = grupo.anterior.montoTotal();
            if (confirmar) {
                total = 0;
                for (var item : grupo.items) {
                    var oferta = item.cotizacion;
                    long precio = oferta.precioUnitario().longValueExact();
                    total += precio * item.anterior.cantidad();
                    diario.jdbc().update("""
                            UPDATE orden_items SET producto_id=?, producto_nombre=?, precio_unitario=?, subtotal=? WHERE id=? AND orden_id=?
                            """, oferta.productoId(), oferta.productoNombre(), precio, precio * item.anterior.cantidad(),
                            item.anterior.ordenItemId(), grupo.anterior.ordenId());
                    if (!soloCotizacion) diario.jdbc().update("""
                            INSERT INTO orden_reservas (orden_id, oferta_id, reserva_id, intento_id) VALUES (?, ?, ?, ?)
                            """, grupo.anterior.ordenId(), item.anterior.ofertaId(), item.reservaId, r.id());
                }
            } else diario.jdbc().update("DELETE FROM orden_reservas WHERE orden_id=?", grupo.anterior.ordenId());
            String estado = soloCotizacion ? "REVISION_REQUERIDA" : confirmar ? "PENDIENTE_PAGO" : "CANCELADO";
            int cambiadas = diario.jdbc().update("""
                    UPDATE ordenes SET estado=?, monto_total=?, cafeteria_nombre=?, version=version+1, updated_at=? WHERE id=? AND version=?
                    """, estado, total, confirmar ? grupo.items.getFirst().cotizacion.cafeteriaNombre() : grupo.anterior.cafeteriaNombre(),
                    utc(ahora), grupo.anterior.ordenId(), grupo.anterior.version() - 1);
            if (cambiadas != 1) throw new IllegalStateException("La orden cambió durante la revisión");
        }
        var activas = diario.jdbc().queryForList("SELECT estado, monto_total FROM ordenes WHERE compra_id=? AND estado<>'CANCELADO'", r.compraId());
        long total = activas.stream().mapToLong(o -> ((Number) o.get("monto_total")).longValue()).sum();
        String estado = activas.isEmpty() ? "CANCELADO"
                : activas.stream().anyMatch(o -> o.get("estado").equals("REVISION_REQUERIDA")) ? "REVISION_REQUERIDA" : "PENDIENTE_PAGO";
        int cambiadas = diario.jdbc().update("""
                UPDATE compras SET estado=?, monto_total=?, version=version+1, updated_at=? WHERE id=? AND version=? AND revision_pendiente=?
                """, estado, total, utc(ahora), r.compraId(), plan.compra.version() - 1, r.id());
        if (cambiadas != 1) throw new IllegalStateException("La compra cambió durante la revisión");
        em.clear();
        CompraResponse compra = consultas.compra(r.usuario(), r.compraId());
        for (var grupo : plan.grupos) {
            OrdenResponse orden = compra.ordenes().stream().filter(o -> o.ordenId().equals(grupo.anterior.ordenId())).findFirst().orElseThrow();
            eventos.orden(grupo.anterior, orden, r.usuario(), r.trace(), ahora);
        }
        eventos.compra(plan.compra, compra, r.trace(), ahora);
        if (soloCotizacion) return terminarError(r, 409, "PRECIO_CAMBIO",
                "La cotización cambió; revísala y confirma con una nueva clave.", compra);
        Object body = r.ordenId() == null ? compra
                : compra.ordenes().stream().filter(o -> o.ordenId().equals(r.ordenId())).findFirst().orElseThrow();
        String texto = diario.json().writeValueAsString(body);
        diario.terminar(r, 200, texto, ahora);
        return new Respuesta(200, texto, false, false);
    }
    private Respuesta terminarError(DiarioRevision.Registro r, int status, String code, String detail, CompraResponse compra) {
        Respuesta respuesta = problema(status, code, detail, r.trace(), r.ruta(), compra, false);
        diario.terminar(r, status, respuesta.cuerpo(), ahora()); return respuesta;
    }
    private Respuesta problema(int status, String code, String detail, String trace, String ruta, CompraResponse compra, boolean reintentar) {
        var body = new LinkedHashMap<String, Object>();
        body.put("type", "/problems/" + code.toLowerCase(Locale.ROOT).replace('_', '-'));
        body.put("title", "No se pudo completar la revisión"); body.put("status", status); body.put("detail", detail);
        body.put("code", code); body.put("traceId", trace); body.put("timestamp", ahora());
        body.put("instance", ruta);
        if (compra != null) body.put("compra", compra);
        return new Respuesta(status, diario.json().writeValueAsString(body), false, reintentar);
    }
    private Instant ahora() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private static String trace() {
        String trace = MDC.get("traceId");
        return trace != null && trace.matches("[a-fA-F0-9]{32}") ? trace : UUID.randomUUID().toString().replace("-", "");
    }
}
