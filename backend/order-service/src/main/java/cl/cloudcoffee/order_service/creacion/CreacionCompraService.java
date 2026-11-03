package cl.cloudcoffee.order_service.creacion;

import cl.cloudcoffee.errors.BusinessException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.slf4j.MDC;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

@Service
public class CreacionCompraService {
    private final DiarioCreacion diario;
    private final CatalogoCompras catalogo;
    private final TransactionTemplate tx;
    private final Clock clock;
    public CreacionCompraService(DiarioCreacion diario, CatalogoCompras catalogo,
            PlatformTransactionManager manager, Clock clock) {
        this.diario = diario; this.catalogo = catalogo; this.tx = new TransactionTemplate(manager); this.clock = clock;
    }
    public record Item(UUID ofertaId, int cantidad) {}
    public record Respuesta(int status, String cuerpo, String location, boolean replay) {}

    public Respuesta crear(UUID usuario, UUID clave, JsonNode cuerpo) {
        List<Item> items = validar(cuerpo);
        String solicitud = diario.json().writeValueAsString(items);
        String hash = hash(solicitud);
        // Espacio exclusivo de POST /compras; el usuario forma parte de la identidad.
        UUID id = UUID.nameUUIDFromBytes((usuario + ":POST:/compras:" + clave).getBytes(StandardCharsets.UTF_8));
        boolean replay = false;
        try {
            tx.executeWithoutResult(status -> {
                Instant ahora = clock.instant().truncatedTo(ChronoUnit.MICROS);
                String trace = MDC.get("traceId");
                if (trace == null || !trace.matches("[a-fA-F0-9]{32}")) trace = UUID.randomUUID().toString().replace("-", "");
                diario.jdbc().update("""
                        INSERT INTO creacion_compras (id, usuario_id, clave, hash_cuerpo, solicitud, trace_id, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, id, usuario, clave, hash, solicitud, trace, Timestamp.from(ahora), Timestamp.from(ahora));
            });
        } catch (DuplicateKeyException duplicate) { replay = true; }
        var registro = diario.buscar(id, false);
        if (!registro.hash().equals(hash)) throw error("IDEMPOTENCY_CONFLICT", "La clave ya se usó con otro contenido.", 409);
        for (int paso = 0; paso < 500; paso++) {
            Respuesta respuesta;
            try { respuesta = avanzar(id); }
            catch (PessimisticLockingFailureException | QueryTimeoutException ocupado) {
                return problema(409, "IDEMPOTENCY_IN_PROGRESS", "La creación está en curso; reintenta con la misma clave.", registro);
            }
            if (respuesta != null) return new Respuesta(respuesta.status(), respuesta.cuerpo(), respuesta.location(),
                    replay && respuesta.status() != 503 && esTerminal(id));
        }
        return problema(409, "IDEMPOTENCY_IN_PROGRESS", "La creación está en curso; reintenta con la misma clave.", registro);
    }

    private boolean esTerminal(UUID id) { return diario.buscar(id, false).fase().equals("TERMINADA"); }

    /** Un paso, un bloqueo NOWAIT y una transacción. No hay locks ni decisiones solo en memoria. */
    public Respuesta avanzar(UUID id) {
        return tx.execute(status -> {
            var r = diario.buscar(id, true);
            if (r.fase().equals("TERMINADA")) return new Respuesta(r.status(), r.respuesta(), r.location(), true);
            try {
                if (r.fase().equals("NUEVA")) { cotizar(r); return null; }
                PlanCompra plan = diario.json().readValue(r.plan(), PlanCompra.class);
                if (plan.fallo == null && !clock.instant().isBefore(plan.venceAt)) {
                    fallar(plan, "RESERVA_VENCIDA"); diario.guardarPlan(id, plan); return null;
                }
                for (var grupo : plan.grupos) {
                    if (grupo.fase.equals("RESERVANDO")) {
                        for (var item : grupo.items) {
                            if (item.reservaId != null) continue;
                            if (!item.solicitada) { item.solicitada = true; diario.guardarPlan(id, plan); return null; }
                            try {
                                var reserva = reservar(r, plan, grupo, item);
                                item.reservaId = reserva.reservationId();
                                if (!"RESERVED".equals(reserva.status())) grupo.fase = "LIBERANDO";
                            } catch (CatalogoCompras.Rechazo rechazo) {
                                item.liberada = true; // respuesta definitiva: esta petición no reservó.
                                if (rechazo.code.equals("STOCK_NO_DISPONIBLE")) grupo.fase = "LIBERANDO";
                                else fallar(plan, rechazo.code);
                            }
                            diario.guardarPlan(id, plan); return null;
                        }
                        grupo.fase = "LISTA"; diario.guardarPlan(id, plan); return null;
                    }
                    if (grupo.fase.equals("LIBERANDO")) {
                        for (var item : grupo.items) {
                            if (item.liberada || !item.solicitada) continue;
                            if (item.reservaId == null) {
                                // Resuelve también una respuesta de reserva perdida antes del reinicio.
                                try { item.reservaId = reservar(r, plan, grupo, item).reservationId(); }
                                catch (CatalogoCompras.Rechazo noReservada) { item.liberada = true; }
                                diario.guardarPlan(id, plan); return null;
                            }
                            catalogo.liberar(item.reservaId);
                            item.liberada = true; diario.guardarPlan(id, plan); return null;
                        }
                        grupo.fase = "REVISION"; diario.guardarPlan(id, plan); return null;
                    }
                }
                if (plan.fallo != null) return terminarProblema(r, 409, plan.fallo,
                        "No se pudo crear la compra; las reservas de este intento fueron liberadas.");
                var compra = diario.materializar(r, plan);
                String body = diario.json().writeValueAsString(compra);
                String location = "/v1/compras/" + compra.compraId();
                diario.terminar(id, 201, body, location);
                return new Respuesta(201, body, location, false);
            } catch (CatalogoCompras.NoDisponible unavailable) {
                diario.jdbc().update("UPDATE creacion_compras SET updated_at=? WHERE id=?", Timestamp.from(clock.instant()), id);
                return problema(503, "OPERACION_PENDIENTE", "No se pudo completar la operación; reintenta con la misma clave.", r);
            } catch (CatalogoCompras.Rechazo rechazo) {
                // Cotización rechazada antes de tocar stock; conserva el resultado definitivo.
                return terminarProblema(r, 409, rechazo.code, "Las ofertas no están disponibles para esta compra.");
            }
        });
    }

    private CatalogoCompras.Reserva reservar(DiarioCreacion.Registro r, PlanCompra plan,
            PlanCompra.Grupo grupo, PlanCompra.Linea item) {
        return catalogo.reservar(grupo.ordenId, item.oferta.ofertaId(), item.cantidad, r.id(),
                plan.venceAt, item.oferta.precioUnitario());
    }
    private void cotizar(DiarioCreacion.Registro r) {
        Item[] items = diario.json().readValue(r.solicitud(), Item[].class);
        var ofertas = catalogo.cotizar(Arrays.stream(items).map(Item::ofertaId).toList());
        if (ofertas.size() != items.length || ofertas.stream().anyMatch(o -> o == null || o.ofertaId() == null
                || o.productoId() == null || o.productoNombre() == null || o.productoNombre().isBlank()
                || o.cafeteriaId() == null || o.cafeteriaNombre() == null || o.cafeteriaNombre().isBlank()
                || o.campusId() == null || o.precioUnitario() == null)) throw new CatalogoCompras.NoDisponible();
        Map<UUID, CatalogoCompras.Oferta> porId = new HashMap<>();
        ofertas.forEach(o -> porId.put(o.ofertaId(), o));
        if (porId.size() != items.length || Arrays.stream(items).anyMatch(i -> !porId.containsKey(i.ofertaId())))
            throw new CatalogoCompras.NoDisponible();
        if (ofertas.stream().map(CatalogoCompras.Oferta::campusId).distinct().count() != 1)
            throw new CatalogoCompras.Rechazo("OFERTA_NO_DISPONIBLE");
        var plan = new PlanCompra();
        plan.creadoAt = r.creadoAt(); plan.venceAt = r.creadoAt().plusSeconds(900);
        Map<UUID, PlanCompra.Grupo> grupos = new TreeMap<>();
        long total = 0;
        try {
            for (Item item : items) {
                var oferta = porId.get(item.ofertaId());
                long precio = oferta.precioUnitario().longValueExact();
                if (precio < 0 || precio > 2_000_000_000L) throw new ArithmeticException();
                total = Math.addExact(total, Math.multiplyExact(precio, item.cantidad()));
                if (total > 2_000_000_000L) throw new ArithmeticException();
                var grupo = grupos.computeIfAbsent(oferta.cafeteriaId(), id -> {
                    var g = new PlanCompra.Grupo(); g.cafeteriaId = id; g.cafeteriaNombre = oferta.cafeteriaNombre(); return g;
                });
                var linea = new PlanCompra.Linea(); linea.oferta = oferta; linea.cantidad = item.cantidad();
                grupo.items.add(linea);
            }
        } catch (ArithmeticException montoInvalido) {
            terminarProblema(r, 400, "MONTO_INVALIDO", "El total debe ser entero en CLP y no superar 2.000.000.000.");
            return;
        }
        plan.grupos.addAll(grupos.values());
        diario.guardarPlan(r.id(), plan);
    }
    private static void fallar(PlanCompra plan, String code) {
        plan.fallo = code;
        plan.grupos.forEach(g -> g.fase = "LIBERANDO");
    }
    private Respuesta terminarProblema(DiarioCreacion.Registro r, int status, String code, String detail) {
        Respuesta respuesta = problema(status, code, detail, r);
        diario.terminar(r.id(), status, respuesta.cuerpo(), null);
        return respuesta;
    }
    private Respuesta problema(int status, String code, String detail, DiarioCreacion.Registro r) {
        return new Respuesta(status, diario.json().writeValueAsString(Map.of("type", "/problems/" + code.toLowerCase(Locale.ROOT).replace('_', '-'),
                "title", status == 503 ? "Operación pendiente" : "No se pudo crear la compra", "status", status,
                "detail", detail, "code", code, "traceId", r.trace(), "instance", "/compras", "timestamp", clock.instant())), null, false);
    }
    private static List<Item> validar(JsonNode body) {
        if (body == null || !body.isObject() || body.size() != 1 || !body.has("items")
                || !body.get("items").isArray() || body.get("items").isEmpty() || body.get("items").size() > 100)
            throw error("SOLICITUD_INVALIDA", "Se requieren entre 1 y 100 ítems y solo se admite el campo items.", 400);
        var items = new ArrayList<Item>(); var ids = new HashSet<UUID>();
        for (JsonNode node : body.get("items")) {
            if (!node.isObject() || node.size() != 2 || !node.has("ofertaId") || !node.get("ofertaId").isString()
                    || !node.has("cantidad") || !node.get("cantidad").isIntegralNumber()
                    || !node.get("cantidad").canConvertToInt()) throw error("SOLICITUD_INVALIDA", "Ítem inválido.", 400);
            UUID oferta = uuid(node.get("ofertaId").asString());
            int cantidad = node.get("cantidad").asInt();
            if (cantidad < 1 || cantidad > 100 || !ids.add(oferta))
                throw error("SOLICITUD_INVALIDA", "Las ofertas deben ser distintas y las cantidades entre 1 y 100.", 400);
            items.add(new Item(oferta, cantidad));
        }
        items.sort(Comparator.comparing(i -> i.ofertaId().toString()));
        return items;
    }
    public static UUID uuid(String valor) {
        try {
            UUID id = UUID.fromString(valor);
            if (!id.toString().equalsIgnoreCase(valor)) throw new IllegalArgumentException();
            return id;
        } catch (IllegalArgumentException | NullPointerException invalid) {
            throw error("SOLICITUD_INVALIDA", "Se requiere un UUID válido.", 400);
        }
    }
    private static String hash(String body) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    private static BusinessException error(String code, String detail, int status) {
        return new BusinessException(HttpStatus.valueOf(status), URI.create("/problems/" + code.toLowerCase(Locale.ROOT).replace('_', '-')),
                "Solicitud inválida", detail, code);
    }
}
