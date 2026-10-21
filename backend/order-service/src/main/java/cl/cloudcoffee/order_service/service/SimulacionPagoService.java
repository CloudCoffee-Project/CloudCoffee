package cl.cloudcoffee.order_service.service;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.order_service.dto.PagoResponse;
import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EscenarioPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.model.RegistroIdempotencia;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.order_service.repository.RegistroIdempotenciaRepository;
import tools.jackson.databind.json.JsonMapper;

/**
 * INT2-76 conforme al contrato de INT2-50 (#112): pago simulado único por compra, con
 * escenarios deterministas y sin proveedor externo, tarjeta, initPoint ni webhooks.
 *
 * Idempotencia por (usuario, método, ruta, clave): la misma clave con el mismo cuerpo
 * reproduce el código y el cuerpo originales; con otro cuerpo responde
 * IDEMPOTENCY_CONFLICT. Otra clave nunca crea ni resuelve un pago: PAGO_YA_INICIADO.
 */
@Service
public class SimulacionPagoService {

    static final String METODO = "POST";

    private final CompraRepository compraRepository;
    private final PagoRepository pagoRepository;
    private final RegistroIdempotenciaRepository idempotencia;
    private final PagoService pagoService;
    private final JsonMapper jsonMapper;

    public SimulacionPagoService(CompraRepository compraRepository, PagoRepository pagoRepository,
            RegistroIdempotenciaRepository idempotencia, PagoService pagoService, JsonMapper jsonMapper) {
        this.compraRepository = compraRepository;
        this.pagoRepository = pagoRepository;
        this.idempotencia = idempotencia;
        this.pagoService = pagoService;
        this.jsonMapper = jsonMapper;
    }

    /** Respuesta HTTP terminada; {@code replay} indica que reproduce la primera. */
    public record Respuesta(int status, String cuerpo, String location, boolean replay) {
    }

    @Transactional
    public Respuesta simular(UUID usuarioId, UUID compraId, UUID clave, EscenarioPago escenario) {
        // El bloqueo de la compra serializa comandos concurrentes, con o sin la misma clave.
        // Se valida el acceso antes de revelar cualquier resultado previo.
        Compra compra = compraDelPropietario(compraRepository.findForUpdate(compraId), usuarioId);
        String ruta = ruta(compra.getId());
        String hash = hash(escenario);

        Optional<RegistroIdempotencia> previo =
                idempotencia.findByUsuarioIdAndMetodoAndRutaAndClave(usuarioId, METODO, ruta, clave);
        if (previo.isPresent()) {
            if (!previo.get().getHashCuerpo().equals(hash)) {
                throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/idempotency-conflict"),
                        "Clave de idempotencia reutilizada",
                        "La clave ya se usó para esta compra con otro contenido.", "IDEMPOTENCY_CONFLICT");
            }
            RegistroIdempotencia registro = previo.get();
            return new Respuesta(registro.getStatus(), registro.getCuerpo(), registro.getLocation(), true);
        }

        // Un pago por compra: otra clave no crea un segundo pago ni resuelve uno pendiente.
        if (pagoRepository.existsByCompraId(compra.getId())) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/pago-ya-iniciado"),
                    "Pago ya iniciado",
                    "La compra ya tiene un pago; consulta su estado o crea una compra nueva para reintentar.",
                    "PAGO_YA_INICIADO");
        }

        Pago pago = pagoService.iniciarPago(compra.getId(), escenario.motivo());
        if (escenario != EscenarioPago.PENDIENTE) {
            pagoService.registrarResultado(pago.getId(), escenario.estado(), null);
        }
        // Fija versión y fechas antes de tomar la instantánea de la respuesta.
        pagoRepository.flush();

        String cuerpo = jsonMapper.writeValueAsString(PagoResponse.from(pago));
        String location = "/v1" + ruta;
        idempotencia.save(new RegistroIdempotencia(usuarioId, METODO, ruta, clave, hash,
                HttpStatus.CREATED.value(), cuerpo, location));
        return new Respuesta(HttpStatus.CREATED.value(), cuerpo, location, false);
    }

    /** Estado actual del pago; sin efectos ni cobros. */
    @Transactional(readOnly = true)
    public Pago consultar(UUID usuarioId, UUID compraId) {
        Compra compra = compraDelPropietario(compraRepository.findById(compraId), usuarioId);
        return pagoRepository.findByCompraId(compra.getId())
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/pago-no-encontrado"), "Pago no encontrado",
                        "La compra todavía no tiene un pago.", "PAGO_NO_ENCONTRADO"));
    }

    static String ruta(UUID compraId) {
        return "/compras/" + compraId + "/pago";
    }

    // Cuerpo normalizado: el único campo admitido es el escenario.
    private static String hash(EscenarioPago escenario) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(("escenario=" + escenario.codigo()).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    // Una compra ajena responde igual que una inexistente: no revela que existe.
    private static Compra compraDelPropietario(Optional<Compra> compra, UUID usuarioId) {
        return compra.filter(encontrada -> encontrada.getUsuarioId().equals(usuarioId))
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/compra-no-encontrada"), "Compra no encontrada",
                        "No existe una compra con el identificador indicado.", "COMPRA_NO_ENCONTRADA"));
    }
}
