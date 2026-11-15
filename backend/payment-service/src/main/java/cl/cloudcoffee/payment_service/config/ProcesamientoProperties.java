package cl.cloudcoffee.payment_service.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * INT2-112: tareas durables de Payment (inbox de webhooks, conciliación con el proveedor y outbox de eventos).
 *
 * @param enabled              activa las tareas programadas; las pruebas las invocan directamente.
 * @param pollInterval         espera entre rondas de cada tarea.
 * @param reconciliationInterval cada cuánto se consulta al proveedor por una intención sin resultado final, aunque
 *                             no llegue ninguna notificación.
 * @param expiryGrace          si el proveedor no responde, tras este margen posterior a {@code expiraAt} la intención
 *                             vence igual (una aprobación posterior queda en conciliación, nunca se pierde).
 * @param lateApprovalWindow   cuánto tiempo después del vencimiento se sigue buscando una aprobación tardía.
 * @param maxAttempts          intentos de procesar una notificación o publicar un evento antes de darlo por muerto.
 * @param retryBackoff         espera base entre intentos; se duplica en cada intento hasta {@code maxBackoff}.
 * @param maxBackoff           espera máxima entre intentos.
 * @param lease                tiempo que un trabajador reserva una fila antes de que otro pueda retomarla.
 */
@ConfigurationProperties("cloudcoffee.payment.processing")
public record ProcesamientoProperties(Boolean enabled, Duration pollInterval, Duration reconciliationInterval,
        Duration expiryGrace, Duration lateApprovalWindow, Integer maxAttempts, Duration retryBackoff,
        Duration maxBackoff, Duration lease) {

    public ProcesamientoProperties {
        if (enabled == null) enabled = true;
        pollInterval = positive(pollInterval, Duration.ofSeconds(5), "poll-interval");
        reconciliationInterval = positive(reconciliationInterval, Duration.ofMinutes(2), "reconciliation-interval");
        expiryGrace = positive(expiryGrace, Duration.ofMinutes(5), "expiry-grace");
        lateApprovalWindow = positive(lateApprovalWindow, Duration.ofDays(3), "late-approval-window");
        retryBackoff = positive(retryBackoff, Duration.ofSeconds(10), "retry-backoff");
        maxBackoff = positive(maxBackoff, Duration.ofMinutes(15), "max-backoff");
        lease = positive(lease, Duration.ofMinutes(1), "lease");
        if (maxAttempts == null) maxAttempts = 12;
        if (maxAttempts < 1) throw new IllegalArgumentException("Payment processing max-attempts must be at least 1");
    }

    public static ProcesamientoProperties defaults() {
        return new ProcesamientoProperties(null, null, null, null, null, null, null, null, null);
    }

    /** Espera antes del intento siguiente: retryBackoff × 2^(intentos-1), acotada por maxBackoff. */
    public Duration backoff(int intentos) {
        Duration espera = retryBackoff;
        for (int i = 1; i < intentos && espera.compareTo(maxBackoff) < 0; i++) espera = espera.multipliedBy(2);
        return espera.compareTo(maxBackoff) > 0 ? maxBackoff : espera;
    }

    private static Duration positive(Duration value, Duration fallback, String name) {
        if (value == null) return fallback;
        if (value.isNegative() || value.isZero()) {
            throw new IllegalArgumentException("Payment processing " + name + " must be a positive duration");
        }
        return value;
    }
}
