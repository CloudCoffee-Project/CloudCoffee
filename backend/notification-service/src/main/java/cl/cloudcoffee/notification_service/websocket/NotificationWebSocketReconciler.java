package cl.cloudcoffee.notification_service.websocket;

import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;

/**
 * Reconcilia el estado de recursos suscritos por WebSocket con consultas HTTP tras
 * reconexión o salto de versión, ignorando eventos duplicados o anteriores (INT2-81).
 */
@Component
public class NotificationWebSocketReconciler {

    private static final String ORDER_DELIVERED = "order.orden.entregada.v1";

    public enum Resolution {
        APPLIED_EVENT,
        RECONCILED_VIA_HTTP,
        IGNORED_DUPLICATE,
        IGNORED_STALE
    }

    public record ResourceSnapshot(
            UUID resourceId,
            String status,
            long version,
            String lastTraceId,
            UUID lastEventId,
            String lastEventType
    ) {
        public ResourceSnapshot {
            Objects.requireNonNull(resourceId, "resourceId es obligatorio");
            Objects.requireNonNull(status, "status es obligatorio");
            if (version < 1) {
                throw new IllegalArgumentException("version debe ser mayor o igual a 1");
            }
        }
    }

    public record ReconciliationOutcome(
            Resolution resolution,
            ResourceSnapshot snapshot
    ) {
    }

    private final Map<UUID, ResourceSnapshot> snapshots = new ConcurrentHashMap<>();
    private final Set<UUID> processedEventIds = ConcurrentHashMap.newKeySet();

    public ReconciliationOutcome reconcileOnReconnect(
            UUID resourceId,
            Supplier<ResourceSnapshot> httpSnapshotSupplier
    ) {
        Objects.requireNonNull(resourceId, "resourceId es obligatorio");
        Objects.requireNonNull(httpSnapshotSupplier, "httpSnapshotSupplier es obligatorio");

        ResourceSnapshot httpSnapshot = Objects.requireNonNull(
                httpSnapshotSupplier.get(), "La consulta HTTP de reconciliación no devolvió estado");
        if (!resourceId.equals(httpSnapshot.resourceId())) {
            throw new IllegalArgumentException("El recurso devuelto por HTTP no coincide con el esperado");
        }

        ResourceSnapshot merged = snapshots.compute(resourceId, (id, current) -> {
            if (current == null || httpSnapshot.version() >= current.version()) {
                return new ResourceSnapshot(
                        resourceId,
                        httpSnapshot.status(),
                        httpSnapshot.version(),
                        httpSnapshot.lastTraceId() != null ? httpSnapshot.lastTraceId()
                                : (current != null ? current.lastTraceId() : null),
                        httpSnapshot.lastEventId() != null ? httpSnapshot.lastEventId()
                                : (current != null ? current.lastEventId() : null),
                        httpSnapshot.lastEventType() != null ? httpSnapshot.lastEventType()
                                : (current != null ? current.lastEventType() : null));
            }
            return current;
        });

        return new ReconciliationOutcome(Resolution.RECONCILED_VIA_HTTP, merged);
    }

    public ReconciliationOutcome onEvent(
            UUID resourceId,
            CloudCoffeeEvent event,
            Supplier<ResourceSnapshot> httpSnapshotSupplier
    ) {
        Objects.requireNonNull(resourceId, "resourceId es obligatorio");
        validateEvent(event);
        Objects.requireNonNull(httpSnapshotSupplier, "httpSnapshotSupplier es obligatorio");

        if (!processedEventIds.add(event.eventId())) {
            ResourceSnapshot existing = snapshots.get(resourceId);
            return new ReconciliationOutcome(Resolution.IGNORED_DUPLICATE, existing);
        }

        long incomingVersion = requiredVersion(event);
        String incomingStatus = extractStatus(event);
        ResourceSnapshot current = snapshots.get(resourceId);

        if (current == null) {
            if (incomingVersion > 1) {
                return reconcileOnReconnect(resourceId, httpSnapshotSupplier);
            }
            ResourceSnapshot initial = new ResourceSnapshot(
                    resourceId, incomingStatus, incomingVersion,
                    event.traceId(), event.eventId(), event.eventType());
            snapshots.put(resourceId, initial);
            return new ReconciliationOutcome(Resolution.APPLIED_EVENT, initial);
        }

        if (incomingVersion < current.version()) {
            return new ReconciliationOutcome(Resolution.IGNORED_STALE, current);
        }

        if (incomingVersion == current.version()) {
            // order.orden.entregada.v1 comparte versión con el cambio a entregado, pero tiene distinto eventId.
            if (ORDER_DELIVERED.equals(event.eventType()) && !ORDER_DELIVERED.equals(current.lastEventType())) {
                ResourceSnapshot delivered = new ResourceSnapshot(
                        resourceId,
                        incomingStatus != null ? incomingStatus : current.status(),
                        incomingVersion,
                        event.traceId(),
                        event.eventId(),
                        event.eventType());
                snapshots.put(resourceId, delivered);
                return new ReconciliationOutcome(Resolution.APPLIED_EVENT, delivered);
            }
            return new ReconciliationOutcome(Resolution.IGNORED_STALE, current);
        }

        if (incomingVersion > current.version() + 1) {
            ReconciliationOutcome reconciled = reconcileOnReconnect(resourceId, httpSnapshotSupplier);
            ResourceSnapshot reconciledSnapshot = reconciled.snapshot();
            if (reconciledSnapshot.lastTraceId() == null) {
                reconciledSnapshot = new ResourceSnapshot(
                        reconciledSnapshot.resourceId(),
                        reconciledSnapshot.status(),
                        reconciledSnapshot.version(),
                        event.traceId(),
                        event.eventId(),
                        event.eventType());
                snapshots.put(resourceId, reconciledSnapshot);
            }
            return new ReconciliationOutcome(Resolution.RECONCILED_VIA_HTTP, reconciledSnapshot);
        }

        ResourceSnapshot next = new ResourceSnapshot(
                resourceId,
                incomingStatus != null ? incomingStatus : current.status(),
                incomingVersion,
                event.traceId(),
                event.eventId(),
                event.eventType());
        snapshots.put(resourceId, next);
        return new ReconciliationOutcome(Resolution.APPLIED_EVENT, next);
    }

    public Optional<ResourceSnapshot> currentSnapshot(UUID resourceId) {
        return Optional.ofNullable(snapshots.get(resourceId));
    }

    private static void validateEvent(CloudCoffeeEvent event) {
        if (event == null || event.eventId() == null
                || event.traceId() == null || event.traceId().isBlank()
                || event.eventType() == null || event.eventType().isBlank()
                || event.payload() == null) {
            throw new IllegalArgumentException("El evento WebSocket no contiene los metadatos obligatorios");
        }
    }

    private static long requiredVersion(CloudCoffeeEvent event) {
        Object raw = event.payload().get("version");
        if (raw instanceof Number number && number.longValue() >= 1) {
            return number.longValue();
        }
        if (raw instanceof String text) {
            try {
                long parsed = Long.parseLong(text);
                if (parsed >= 1) {
                    return parsed;
                }
            } catch (NumberFormatException ignored) {
                // Manejado abajo
            }
        }
        throw new IllegalArgumentException("El evento WebSocket requiere una version positiva");
    }

    private static String extractStatus(CloudCoffeeEvent event) {
        Object estado = event.payload().get("estado");
        if (estado instanceof String text && !text.isBlank()) {
            return text;
        }
        if (ORDER_DELIVERED.equals(event.eventType())) {
            return "entregado";
        }
        Object stock = event.payload().get("stockActual");
        if (stock != null) {
            return "stock:" + stock;
        }
        return "actualizado";
    }
}