package cl.cloudcoffee.order_service.service;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.PagoSandboxResponse;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoCompra;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Orden;
import cl.cloudcoffee.order_service.model.OrdenItem;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.model.RegistroIdempotencia;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.Checkout;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutListo;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutPendiente;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.CheckoutRechazado;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago.SolicitudCheckout;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.repository.RegistroIdempotenciaRepository;
import jakarta.persistence.EntityManager;
import tools.jackson.databind.json.JsonMapper;

/**
 * INT2-113: inicio y consulta del pago con payment-service (Mercado Pago sandbox).
 *
 * <ol>
 * <li>Con la compra bloqueada: propietario, idempotencia pública, revisión resuelta y reservas vigentes. Se
 * crea el único pago de la compra (pendiente, {@code esperando_proveedor}) y se congela la solicitud a
 * Payment: ítems y total salen de los snapshots de Order, nunca del cliente.</li>
 * <li>Fuera de la transacción se pide el checkout a Payment con una clave derivada del pago: reintentos,
 * réplicas concurrentes o la conciliación tras un reinicio envían la misma clave y carga, y Payment no crea
 * otra preferencia.</li>
 * <li>Se guardan paymentId, preferencia e initPoint, que se devuelven también al repetir o consultar.</li>
 * </ol>
 */
@Service
public class PagoSandboxService {

    private static final Logger LOG = LoggerFactory.getLogger(PagoSandboxService.class);
    static final String METODO = "POST";

    private final CompraRepository compras;
    private final PagoRepository pagos;
    private final RegistroIdempotenciaRepository idempotencia;
    private final ResultadoPagoService resultados;
    private final PasarelaPago pasarela;
    private final JdbcTemplate jdbc;
    private final EntityManager em;
    private final Clock clock;
    private final TransactionTemplate tx;
    private final JsonMapper json = JsonMapper.builder().build();

    public PagoSandboxService(CompraRepository compras, PagoRepository pagos, RegistroIdempotenciaRepository idempotencia,
            ResultadoPagoService resultados, PasarelaPago pasarela, JdbcTemplate jdbc, EntityManager em, Clock clock,
            PlatformTransactionManager manager) {
        this.compras = compras;
        this.pagos = pagos;
        this.idempotencia = idempotencia;
        this.resultados = resultados;
        this.pasarela = pasarela;
        this.jdbc = jdbc;
        this.em = em;
        this.clock = clock;
        this.tx = new TransactionTemplate(manager);
    }

    public record Respuesta(PagoSandboxResponse pago, boolean replay) {
    }

    /** Estado del intento de obtener el checkout de un pago ya creado. */
    public sealed interface Asegurado permits Listo, Pendiente, Rechazado {
    }

    public record Listo() implements Asegurado {
    }

    public record Pendiente(String codigo) implements Asegurado {
    }

    public record Rechazado(String codigo) implements Asegurado {
    }

    private record Registro(UUID pagoId, boolean replay) {
    }

    public Respuesta iniciar(UUID usuarioId, UUID compraId, UUID clave, String canalRetorno) {
        Registro registro = tx.execute(status -> registrar(usuarioId, compraId, clave, canalRetorno));
        switch (asegurarPreferencia(registro.pagoId())) {
            case Listo listo -> {
                // Con correlación: se responde con la proyección actual.
            }
            case Pendiente pendiente -> throw new PagoNoDisponibleException("PAGO_EN_CONCILIACION",
                    "El checkout todavía no está disponible. Reintenta con la misma Idempotency-Key.");
            case Rechazado rechazado when "RESERVA_VENCIDA".equals(rechazado.codigo()) ->
                    throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/reserva-vencida"),
                            "Reserva vencida", "El plazo de la compra terminó; crea una compra nueva.", "RESERVA_VENCIDA");
            case Rechazado rechazado -> {
                LOG.error("Payment rechazó el checkout del pago {}: {}", registro.pagoId(), rechazado.codigo());
                throw new PagoNoDisponibleException("PROVEEDOR_NO_DISPONIBLE",
                        "El proveedor de pagos no está disponible. Reintenta más tarde.");
            }
        }
        return new Respuesta(proyeccion(registro.pagoId()), registro.replay());
    }

    private Registro registrar(UUID usuarioId, UUID compraId, UUID clave, String canal) {
        // El bloqueo de la compra serializa comandos concurrentes, con o sin la misma clave.
        Compra compra = delPropietario(compras.findForUpdate(compraId), usuarioId);
        String ruta = SimulacionPagoService.ruta(compra.getId());
        String hash = hash(canal);
        Optional<RegistroIdempotencia> previo =
                idempotencia.findByUsuarioIdAndMetodoAndRutaAndClave(usuarioId, METODO, ruta, clave);
        if (previo.isPresent()) {
            if (!previo.get().getHashCuerpo().equals(hash)) {
                throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/idempotency-conflict"),
                        "Clave de idempotencia reutilizada",
                        "La clave ya se usó para esta compra con otro contenido.", "IDEMPOTENCY_CONFLICT");
            }
            return new Registro(pagos.findByCompraId(compra.getId()).orElseThrow().getId(), true);
        }
        // Un pago por compra: otra clave no inicia un segundo checkout (la consulta devuelve el existente).
        if (pagos.existsByCompraId(compra.getId())) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/pago-ya-iniciado"),
                    "Pago ya iniciado", "La compra ya tiene un pago; consulta su estado.", "PAGO_YA_INICIADO");
        }
        boolean revisionPendiente = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT revision_pendiente IS NOT NULL FROM compras WHERE id=?", Boolean.class, compra.getId()));
        if (revisionPendiente || compra.getEstado() == EstadoCompra.REVISION_REQUERIDA) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/revision-requerida"),
                    "Revisión requerida", "Resuelve la revisión de la compra antes de pagar.", "REVISION_REQUERIDA");
        }
        if (compra.getEstado() != EstadoCompra.PENDIENTE_PAGO) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/estado-invalido"),
                    "Estado inválido", "La compra no está disponible para iniciar un pago.", "ESTADO_INVALIDO");
        }
        if (!resultados.tieneReservas(compra.getId()) || !clock.instant().isBefore(compra.getReservaExpiraAt())) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/reserva-vencida"),
                    "Reserva vencida", "El plazo de la compra terminó; crea una compra nueva.", "RESERVA_VENCIDA");
        }
        String trace = ResultadoPagoService.trace();
        Pago pago = Pago.externo(compra, canal, solicitud(compra, canal));
        pago.registrarTrace(trace);
        pago = pagos.save(pago);
        pagos.flush();
        resultados.publicarPago(pago, usuarioId, trace);
        // La respuesta se arma siempre desde el estado actual del pago (también al repetir la clave).
        idempotencia.save(new RegistroIdempotencia(usuarioId, METODO, ruta, clave, hash,
                HttpStatus.CREATED.value(), "{}", "/v1" + ruta));
        return new Registro(pago.getId(), false);
    }

    /**
     * Obtiene y guarda el checkout de un pago externo pendiente que aún no lo tiene. Idempotente y seguro entre
     * réplicas: la clave hacia Payment se deriva del pago y la carga es la congelada al crearlo.
     */
    public Asegurado asegurarPreferencia(UUID pagoId) {
        record Datos(String solicitud, UUID compraId, UUID clienteId, long monto) {
        }
        Datos datos = tx.execute(status -> {
            Pago pago = pagos.findById(pagoId).orElseThrow();
            if (!pago.esExterno() || pago.getPreferenciaId() != null || pago.getEstado() != EstadoPago.PENDIENTE) return null;
            return new Datos(pago.getSolicitudPayment(), pago.getCompra().getId(), pago.getCompra().getUsuarioId(),
                    pago.getMonto().longValueExact());
        });
        if (datos == null) return new Listo();
        return switch (pasarela.iniciarCheckout(new SolicitudCheckout(clave(pagoId), datos.solicitud()))) {
            case CheckoutListo listo -> {
                Checkout checkout = listo.checkout();
                if (!datos.compraId().equals(checkout.compraId()) || !datos.clienteId().equals(checkout.clienteId())
                        || datos.monto() != checkout.montoTotal()) {
                    LOG.error("Payment devolvió un checkout que no corresponde al pago {}", pagoId);
                    yield new Pendiente("RESPUESTA_NO_VERIFICABLE");
                }
                tx.executeWithoutResult(status -> {
                    // Mismo bloqueo que los resultados externos: réplicas que obtuvieron el mismo checkout a la vez
                    // se serializan y solo la primera lo guarda.
                    em.clear();
                    compras.findForUpdate(datos.compraId()).orElseThrow();
                    Pago pago = pagos.findById(pagoId).orElseThrow();
                    em.refresh(pago);
                    if (pago.getPaymentId() != null && !pago.getPaymentId().equals(checkout.paymentId())) {
                        throw new IllegalStateException("El pago " + pagoId + " ya tiene otra intención de Payment");
                    }
                    if (pago.getPreferenciaId() == null) {
                        pago.registrarCheckout(checkout.paymentId(), checkout.preferenciaId(), checkout.initPoint());
                    }
                });
                yield new Listo();
            }
            case CheckoutPendiente pendiente -> new Pendiente(pendiente.codigo());
            case CheckoutRechazado rechazado -> new Rechazado(rechazado.codigo());
        };
    }

    /** Proyección actual; sin efectos ni llamadas a Payment. */
    public PagoSandboxResponse consultar(UUID usuarioId, UUID compraId) {
        return tx.execute(status -> {
            Compra compra = delPropietario(compras.findById(compraId), usuarioId);
            Pago pago = pagos.findByCompraId(compra.getId())
                    .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/pago-no-encontrado"),
                            "Pago no encontrado", "La compra todavía no tiene un pago.", "PAGO_NO_ENCONTRADO"));
            if (pago.esExterno() && pago.getPaymentId() == null && pago.getEstado() == EstadoPago.PENDIENTE) {
                throw new PagoNoDisponibleException("PAGO_EN_CONCILIACION",
                        "El checkout todavía se está creando. Reconsulta en unos segundos.");
            }
            return PagoSandboxResponse.from(pago);
        });
    }

    private PagoSandboxResponse proyeccion(UUID pagoId) {
        return tx.execute(status -> {
            em.clear();
            return PagoSandboxResponse.from(pagos.findById(pagoId).orElseThrow());
        });
    }

    /** Clave estable hacia Payment: la misma para cualquier réplica o reintento del mismo pago. */
    static UUID clave(UUID pagoId) {
        return UUID.nameUUIDFromBytes(("order-pago:" + pagoId).getBytes(StandardCharsets.UTF_8));
    }

    /** CrearPreferencia del contrato: ítems de las órdenes activas y total congelados por Order. */
    private String solicitud(Compra compra, String canal) {
        List<Map<String, Object>> items = new ArrayList<>();
        long suma = 0;
        for (Orden orden : compra.getOrdenes()) {
            if (orden.getEstado() != EstadoOrden.PENDIENTE_PAGO) continue;
            for (OrdenItem item : orden.getItems()) {
                long precio = item.getPrecioUnitario().longValueExact();
                Map<String, Object> linea = new LinkedHashMap<>();
                linea.put("ordenId", orden.getId().toString());
                linea.put("ofertaId", item.getOfertaId().toString());
                String titulo = item.getProductoNombre();
                linea.put("titulo", titulo.length() > 255 ? titulo.substring(0, 255) : titulo);
                linea.put("cantidad", item.getCantidad());
                linea.put("precioUnitario", precio);
                items.add(linea);
                suma = Math.addExact(suma, Math.multiplyExact(precio, item.getCantidad()));
            }
        }
        long total = compra.getMontoTotal().longValueExact();
        if (items.isEmpty() || suma != total) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/estado-invalido"), "Estado inválido",
                    "La compra no tiene un detalle cobrable consistente.", "ESTADO_INVALIDO");
        }
        Map<String, Object> cuerpo = new LinkedHashMap<>();
        cuerpo.put("compraId", compra.getId().toString());
        cuerpo.put("clienteId", compra.getUsuarioId().toString());
        cuerpo.put("montoTotal", total);
        cuerpo.put("moneda", "CLP");
        cuerpo.put("items", items);
        cuerpo.put("canalRetorno", canal);
        cuerpo.put("expiraAt", compra.getReservaExpiraAt().toString());
        return json.writeValueAsString(cuerpo);
    }

    private static String hash(String canal) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(("canalRetorno=" + canal).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    // Una compra ajena responde igual que una inexistente: no revela que existe.
    private static Compra delPropietario(Optional<Compra> compra, UUID usuarioId) {
        return compra.filter(encontrada -> encontrada.getUsuarioId().equals(usuarioId))
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/compra-no-encontrada"), "Compra no encontrada",
                        "No existe una compra con el identificador indicado.", "COMPRA_NO_ENCONTRADA"));
    }
}
