package cl.cloudcoffee.payment_service.pagos;

import java.time.Clock;
import java.time.Instant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import cl.cloudcoffee.payment_service.config.ProcesamientoProperties;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.Encontrado;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.Fallida;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.NoEncontrado;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos.Pagos;
import cl.cloudcoffee.payment_service.pagos.ConciliacionPagos.Efecto;
import cl.cloudcoffee.payment_service.pagos.PagosRepository.Candidata;
import cl.cloudcoffee.payment_service.pagos.PagosRepository.EntradaInbox;
import cl.cloudcoffee.payment_service.preferencias.IntencionRepository;

/**
 * Trabajo durable de INT2-112, seguro ante reinicios y varias instancias:
 * <ol>
 * <li>{@link #procesarInbox()}: por cada notificación autenticada consulta el pago al proveedor y lo aplica.
 * Proveedor caído, pago aún no visible o preferencia sin confirmar reprograman con backoff; agotados los
 * intentos la entrada queda DEAD como evidencia.</li>
 * <li>{@link #conciliarIntenciones()}: aunque se pierdan notificaciones, consulta periódicamente los pagos de
 * cada intención por su referencia externa, aplica el vencimiento y sigue buscando aprobaciones tardías.</li>
 * </ol>
 * Cada fila se reclama con un UPDATE condicionado antes de trabajar en ella, de modo que dos instancias nunca
 * procesan la misma a la vez; si una cae, la reserva expira ({@code lease}) y otra la retoma.
 */
@Service
public class ProcesadorPagos {

    private static final Logger log = LoggerFactory.getLogger(ProcesadorPagos.class);
    private static final int LOTE = 20;

    private final PagosRepository repo;
    private final IntencionRepository intenciones;
    private final ConciliacionPagos conciliacion;
    private final ProveedorPagos proveedor;
    private final ProcesamientoProperties config;
    private final Clock clock;

    public ProcesadorPagos(PagosRepository repo, IntencionRepository intenciones, ConciliacionPagos conciliacion,
            ProveedorPagos proveedor, ProcesamientoProperties config, Clock clock) {
        this.repo = repo;
        this.intenciones = intenciones;
        this.conciliacion = conciliacion;
        this.proveedor = proveedor;
        this.config = config;
        this.clock = clock;
    }

    /** Procesa hasta un lote de notificaciones vencidas para su intento. Devuelve cuántas tomó. */
    public int procesarInbox() {
        int tomadas = 0;
        Instant ahora = clock.instant();
        for (EntradaInbox entrada : repo.inboxPendientes(ahora, LOTE)) {
            if (!repo.reclamarInbox(entrada.id(), entrada.intentos(), ahora, ahora.plus(config.lease()))) continue;
            tomadas++;
            int intento = entrada.intentos() + 1;
            try {
                switch (proveedor.consultar(entrada.pagoId())) {
                    case Encontrado encontrado -> {
                        if (conciliacion.aplicar(encontrado.pago(), entrada.traceId(), entrada.id()) == Efecto.SIN_PREFERENCIA) {
                            reintentar(entrada, intento, "PREFERENCIA_PENDIENTE");
                        }
                    }
                    case NoEncontrado noEncontrado -> reintentar(entrada, intento, "PAGO_NO_ENCONTRADO");
                    case Fallida fallida -> reintentar(entrada, intento, "PROVEEDOR_NO_DISPONIBLE");
                }
            } catch (RuntimeException error) {
                log.warn("Error al procesar la notificación {}: {}", entrada.id(), error.getClass().getSimpleName());
                reintentar(entrada, intento, "ERROR_INTERNO");
            }
        }
        return tomadas;
    }

    private void reintentar(EntradaInbox entrada, int intento, String codigo) {
        Instant ahora = clock.instant();
        if (intento >= config.maxAttempts()) {
            log.error("La notificación {} (pago externo {}) agotó {} intentos ({}); queda DEAD para revisión operativa",
                    entrada.id(), entrada.pagoId(), intento, codigo);
            repo.inboxMuerta(entrada.id(), codigo, ahora);
        } else {
            repo.inboxReprogramar(entrada.id(), codigo, ahora.plus(config.backoff(intento)), ahora);
        }
    }

    /** Consulta al proveedor un lote de intenciones (notificaciones perdidas, vencimiento y aprobaciones tardías). */
    public int conciliarIntenciones() {
        Instant ahora = clock.instant();
        int consultadas = 0;
        for (Candidata candidata : repo.candidatasConciliacion(ahora, ahora.minus(config.reconciliationInterval()),
                ahora.minus(config.lateApprovalWindow()), LOTE)) {
            if (!repo.marcarConsultada(candidata.id(), candidata.consultadaAt(), ahora)) continue;
            consultadas++;
            try {
                conciliar(candidata, ahora);
            } catch (RuntimeException error) {
                log.warn("Error al conciliar la intención {}: {}", candidata.id(), error.getClass().getSimpleName());
            }
        }
        return consultadas;
    }

    private void conciliar(Candidata candidata, Instant ahora) {
        var intencion = intenciones.porId(candidata.id());
        String trace = Trazas.actual();
        boolean consultado = false;
        switch (proveedor.buscarPorReferencia(intencion.referenciaExterna())) {
            case Pagos pagos -> {
                consultado = true;
                for (var pago : pagos.pagos()) conciliacion.aplicar(pago, trace, null);
            }
            case Fallida fallida -> log.warn("No se pudieron consultar los pagos de la intención {}: {}",
                    intencion.id(), fallida.motivo());
        }
        // Sin respuesta del proveedor se espera un margen antes de vencer; lo que aparezca después se concilia.
        if (consultado || !ahora.isBefore(intencion.expiraAt().plus(config.expiryGrace()))) {
            conciliacion.vencer(intencion.id(), trace);
        }
    }
}
