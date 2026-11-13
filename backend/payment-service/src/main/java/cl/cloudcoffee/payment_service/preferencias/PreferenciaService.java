package cl.cloudcoffee.payment_service.preferencias;

import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.payment_service.config.PaymentProperties;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias.BusquedaFallida;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias.Creada;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias.Encontradas;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias.Incierta;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias.NoCreada;
import cl.cloudcoffee.payment_service.preferencias.IntencionRepository.Intencion;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * INT2-111: una intención y a lo sumo una preferencia Checkout Pro por compra.
 *
 * <p>Estados técnicos sin preferencia:
 * <ul>
 * <li>CREATING: el proveedor nunca recibió un POST para esta intención (o lo rechazó de forma definitiva);
 * crear es seguro.</li>
 * <li>REQUIRES_RECONCILIATION: hubo (o puede haber) un POST sin resultado confirmado. Antes de crear se busca
 * por la referencia externa estable, y solo se vuelve a crear si la búsqueda sigue vacía pasado el plazo de
 * asentamiento configurado. No se asume que el proveedor deduplica creaciones de preferencias.</li>
 * </ul>
 */
@Service
public class PreferenciaService {

    private static final Logger log = LoggerFactory.getLogger(PreferenciaService.class);
    private static final URI CONFLICTO = URI.create("https://cloudcoffee.cl/problemas/conflicto-pago");
    private static final URI NO_ENCONTRADO = URI.create("https://cloudcoffee.cl/problemas/pago-no-encontrado");

    private final IntencionRepository intenciones;
    private final ProveedorPreferencias proveedor;
    private final PaymentProperties properties;
    private final Clock clock;
    private final JsonMapper json = JsonMapper.builder().build();

    public PreferenciaService(IntencionRepository intenciones, ProveedorPreferencias proveedor,
            PaymentProperties properties, Clock clock) {
        this.intenciones = intenciones;
        this.proveedor = proveedor;
        this.properties = properties;
        this.clock = clock;
    }

    public record Resultado(PreferenciaResponse preferencia, boolean repetida) {
    }

    public Resultado crear(String idempotencyKey, JsonNode cuerpo) {
        if (!properties.enabled()) {
            // Falla cerrada y sin persistir: no se crean intenciones que nadie podría pagar.
            throw new PagoNoDisponibleException("PAYMENT_NOT_ENABLED",
                    "La integración con el proveedor de pagos no está habilitada.", null);
        }
        UUID clave = SolicitudPreferencia.clave(idempotencyKey);
        SolicitudPreferencia solicitud = SolicitudPreferencia.desde(cuerpo);
        String payload = solicitud.canonico(json);
        String hash = SolicitudPreferencia.sha256(payload);
        Registro registro = registrar(clave, solicitud, payload, hash);
        return new Resultado(PreferenciaResponse.from(resolver(registro.intencion(), solicitud)), registro.repetida());
    }

    /** Solo lee lo persistido: nunca llama al proveedor ni inicia pagos. */
    public PreferenciaResponse consultar(UUID compraId) {
        return intenciones.porCompra(compraId).map(PreferenciaResponse::from)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, NO_ENCONTRADO, "Pago no encontrado",
                        "No existe una intención de pago para la compra indicada.", "PAGO_NO_ENCONTRADO"));
    }

    private record Registro(Intencion intencion, boolean repetida) {
    }

    private Registro registrar(UUID clave, SolicitudPreferencia solicitud, String payload, String hash) {
        for (int intento = 0; intento < 3; intento++) {
            var porClave = intenciones.porClave(clave);
            if (porClave.isPresent()) {
                if (!porClave.get().hash().equals(hash)) {
                    throw conflicto("IDEMPOTENCIA_CONFLICTO",
                            "La Idempotency-Key ya se usó con una solicitud distinta.");
                }
                return new Registro(porClave.get(), true);
            }
            var porCompra = intenciones.porCompra(solicitud.compraId());
            if (porCompra.isPresent()) {
                // Otra clave para la misma compra: misma carga devuelve la intención existente; otra carga
                // jamás reemplaza una preferencia que podría haberse pagado.
                if (!porCompra.get().hash().equals(hash)) {
                    throw conflicto("PAGO_YA_INICIADO", "La compra ya tiene un pago iniciado con otros datos.");
                }
                return new Registro(porCompra.get(), true);
            }
            Instant ahora = clock.instant();
            if (!solicitud.expiraAt().isAfter(ahora)) throw vencida();
            UUID id = UUID.randomUUID();
            try {
                intenciones.insertar(id, clave, solicitud, hash, payload, ahora);
                return new Registro(intenciones.porId(id), false);
            } catch (DataIntegrityViolationException carrera) {
                // Otra solicitud insertó la misma clave o compra en paralelo: se relee y se aplica la regla anterior.
            }
        }
        throw enConciliacion();
    }

    private Intencion resolver(Intencion intencion, SolicitudPreferencia solicitud) {
        for (int intento = 0; intento < 3; intento++) {
            if (intencion.preferenciaId() != null) return intencion;
            Instant ahora = clock.instant();
            switch (intencion.estado()) {
                case "CREATING" -> {
                    if (!intencion.expiraAt().isAfter(ahora)) throw vencida();
                    if (intenciones.reclamar(intencion.id(), intencion.version(), "CREATING", ahora)) {
                        return crearEnProveedor(intencion, intencion.version() + 1, solicitud);
                    }
                }
                case "REQUIRES_RECONCILIATION" -> {
                    Intencion conciliada = conciliar(intencion, solicitud, ahora);
                    if (conciliada != null) return conciliada;
                }
                default -> {
                    return intencion;
                }
            }
            intencion = intenciones.porId(intencion.id());
        }
        throw enConciliacion();
    }

    /** Devuelve la intención resuelta, o null si otra solicitud cambió el estado y hay que releer. */
    private Intencion conciliar(Intencion intencion, SolicitudPreferencia solicitud, Instant ahora) {
        var busqueda = proveedor.buscar(intencion.referenciaExterna());
        if (busqueda instanceof BusquedaFallida fallida) {
            log.warn("No se pudo conciliar la intención {}: {}", intencion.id(), fallida.motivo());
            throw enConciliacion();
        }
        var encontradas = ((Encontradas) busqueda).preferencias();
        if (encontradas.size() > 1 || (encontradas.size() == 1 && encontradas.getFirst().checkout() == null)) {
            log.error("La intención {} tiene {} preferencias en el proveedor o una sin checkout válido; requiere revisión operativa",
                    intencion.id(), encontradas.size());
            throw enConciliacion();
        }
        if (encontradas.size() == 1) {
            var preferencia = encontradas.getFirst();
            if (intenciones.guardarPreferencia(intencion.id(), intencion.version(), preferencia.id(),
                    preferencia.checkout().toString(), ahora)) {
                log.info("Intención {} conciliada con la preferencia {}", intencion.id(), preferencia.id());
                return intenciones.porId(intencion.id());
            }
            return null;
        }
        // Sin rastro en el proveedor: solo se recrea después del plazo de asentamiento de la búsqueda.
        if (ahora.isBefore(intencion.actualizadaAt().plus(properties.reconciliationSettleTime()))) {
            throw enConciliacion();
        }
        if (!intencion.expiraAt().isAfter(ahora)) throw vencida();
        if (intenciones.reclamar(intencion.id(), intencion.version(), "REQUIRES_RECONCILIATION", ahora)) {
            return crearEnProveedor(intencion, intencion.version() + 1, solicitud);
        }
        return null;
    }

    private Intencion crearEnProveedor(Intencion intencion, long version, SolicitudPreferencia solicitud) {
        var resultado = proveedor.crear(nueva(intencion, solicitud));
        Instant ahora = clock.instant();
        return switch (resultado) {
            case Creada creada -> {
                var preferencia = creada.preferencia();
                if (!intenciones.guardarPreferencia(intencion.id(), version, preferencia.id(),
                        preferencia.checkout().toString(), ahora)) {
                    // Otra solicitud ya guardó la preferencia hallada por búsqueda (la misma referencia externa).
                    Intencion actual = intenciones.porId(intencion.id());
                    if (!preferencia.id().equals(actual.preferenciaId())) {
                        log.error("La intención {} quedó con la preferencia {} y el proveedor creó además {}",
                                intencion.id(), actual.preferenciaId(), preferencia.id());
                    }
                    yield actual;
                }
                log.info("Preferencia {} creada para la intención {}", preferencia.id(), intencion.id());
                yield intenciones.porId(intencion.id());
            }
            case NoCreada noCreada -> {
                intenciones.liberar(intencion.id(), version, ahora);
                throw new PagoNoDisponibleException("PROVEEDOR_NO_DISPONIBLE",
                        "El proveedor de pagos no está disponible. Reintenta con la misma Idempotency-Key.", 2);
            }
            case Incierta incierta -> {
                log.warn("Resultado incierto al crear la preferencia de la intención {}: {}", intencion.id(), incierta.motivo());
                throw enConciliacion();
            }
        };
    }

    private ProveedorPreferencias.NuevaPreferencia nueva(Intencion intencion, SolicitudPreferencia solicitud) {
        URI base = "mobile".equals(intencion.canal()) ? properties.mobileReturnUrl() : properties.webReturnUrl();
        var items = solicitud.items().stream().map(item -> new ProveedorPreferencias.Item(item.ofertaId(),
                item.ordenId(), item.titulo(), item.cantidad(), item.precioUnitario())).toList();
        return new ProveedorPreferencias.NuevaPreferencia(intencion.id(), intencion.compraId(),
                intencion.referenciaExterna(), items, intencion.expiraAt(), retorno(base, intencion, "exito"),
                retorno(base, intencion, "pendiente"), retorno(base, intencion, "fallo"));
    }

    /** Destino fijo por canal + correlación. El retorno solo reabre el cliente: no acredita el pago. */
    private static URI retorno(URI base, Intencion intencion, String resultado) {
        return UriComponentsBuilder.fromUri(base).queryParam("compraId", intencion.compraId())
                .queryParam("resultado", resultado).build().toUri();
    }

    private static BusinessException conflicto(String code, String detalle) {
        return new BusinessException(HttpStatus.CONFLICT, CONFLICTO, "Conflicto de pago", detalle, code);
    }

    private static BusinessException vencida() {
        return conflicto("RESERVA_VENCIDA", "La compra venció antes de abrir el checkout.");
    }

    private static PagoNoDisponibleException enConciliacion() {
        return new PagoNoDisponibleException("PAGO_EN_CONCILIACION",
                "El resultado con el proveedor de pagos está en conciliación. Reconsulta la misma intención.", 2);
    }
}
