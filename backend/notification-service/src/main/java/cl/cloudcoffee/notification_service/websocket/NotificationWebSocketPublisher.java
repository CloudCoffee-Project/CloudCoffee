package cl.cloudcoffee.notification_service.websocket;

import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import java.util.UUID;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class NotificationWebSocketPublisher {

    private static final String ORDER_STATE_CHANGED = "order.orden.estado-cambiado.v1";
    private static final String ORDER_DELIVERED = "order.orden.entregada.v1";
    private static final String STOCK_UPDATED = "catalog.stock.actualizado.v1";

    private final SimpMessagingTemplate messagingTemplate;
    private final NotificationOrderAccessRepository orderAccessRepository;
    private final NotificationPurchaseAccessRepository purchaseAccessRepository;

    public NotificationWebSocketPublisher(
            SimpMessagingTemplate messagingTemplate,
            NotificationOrderAccessRepository orderAccessRepository,
            NotificationPurchaseAccessRepository purchaseAccessRepository
    ) {
        this.messagingTemplate = messagingTemplate;
        this.orderAccessRepository = orderAccessRepository;
        this.purchaseAccessRepository = purchaseAccessRepository;
    }

    public void publish(CloudCoffeeEvent event) {
        switch (event.eventType()) {
            case "order.compra.creada.v1",
                    "order.compra.estado-cambiado.v1",
                    "order.pago.resultado.v1" -> publishPurchaseEvent(event);
            case ORDER_STATE_CHANGED, ORDER_DELIVERED -> publishOrderEvent(event);
            case STOCK_UPDATED -> publishStockEvent(event);
            default -> throw new IllegalArgumentException(
                    "Tipo de evento no soportado por WebSocket: " + event.eventType());
        }
    }

    private void publishPurchaseEvent(CloudCoffeeEvent event) {
        UUID purchaseId = requiredUuid(event, "compraId");
        UUID clientId = requiredUuid(event, "clienteId");
        purchaseAccessRepository.save(new NotificationPurchaseAccess(purchaseId, clientId));
        messagingTemplate.convertAndSend("/topic/compra/" + purchaseId + "/estado", event);
    }

    private void publishOrderEvent(CloudCoffeeEvent event) {
        UUID purchaseId = requiredUuid(event, "compraId");
        UUID orderId = requiredUuid(event, "ordenId");
        UUID clientId = requiredUuid(event, "clienteId");
        UUID cafeteriaId = requiredUuid(event, "cafeteriaId");
        orderAccessRepository.save(new NotificationOrderAccess(orderId, purchaseId, clientId, cafeteriaId));
        purchaseAccessRepository.save(new NotificationPurchaseAccess(purchaseId, clientId));
        messagingTemplate.convertAndSend("/topic/orden/" + orderId + "/estado", event);
        messagingTemplate.convertAndSend("/topic/cafeteria/" + cafeteriaId + "/ordenes", event);
    }

    private void publishStockEvent(CloudCoffeeEvent event) {
        UUID cafeteriaId = requiredUuid(event, "cafeteriaId");
        messagingTemplate.convertAndSend("/topic/cafeteria/" + cafeteriaId + "/stock", event);
    }

    private static UUID requiredUuid(CloudCoffeeEvent event, String key) {
        Object value = event.payload().get(key);
        if (value instanceof UUID uuid) {
            return uuid;
        }
        if (value instanceof String stringValue) {
            try {
                return UUID.fromString(stringValue);
            } catch (IllegalArgumentException exception) {
                throw new IllegalArgumentException("Campo UUID inválido en evento: " + key, exception);
            }
        }
        throw new IllegalArgumentException("Campo UUID obligatorio ausente en evento: " + key);
    }
}
