package cl.cloudcoffee.notification_service.messaging;

import cl.cloudcoffee.notification_service.email.EmailService;
import cl.cloudcoffee.notification_service.history.NotificationHistoryService;
import cl.cloudcoffee.notification_service.push.NotificationPushService;
import cl.cloudcoffee.notification_service.websocket.NotificationWebSocketPublisher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationEventPushRoutingTests {

    @Mock NotificationHistoryService historyService;
    @Mock EmailService emailService;
    @Mock NotificationWebSocketPublisher webSocketPublisher;
    @Mock NotificationPushService pushService;

    @Test
    void purchaseAndPickupEventsResolveWebsocketAndEnqueuePushSeparately() {
        CloudCoffeeEvent event = event("order.orden.estado-cambiado.v1",
                Map.of("clienteId", UUID.randomUUID().toString()));
        when(historyService.wasSuccessful(event.eventId())).thenReturn(false);

        consumer().consume(event);

        verify(webSocketPublisher).publish(event);
        verify(pushService).enqueueOrderEvent(event);
        verify(historyService).registerSuccess(event);
    }

    @Test
    void generalStockUpdateRemainsWebsocketOnly() {
        CloudCoffeeEvent event = event("catalog.stock.actualizado.v1", Map.of());
        when(historyService.wasSuccessful(event.eventId())).thenReturn(false);

        consumer().consume(event);

        verify(webSocketPublisher).publish(event);
        verify(pushService, never()).enqueueOrderEvent(event);
        verify(pushService, never()).enqueueRestockEvent(event);
    }

    @Test
    void directedRestockUsesOnlyPushDelivery() {
        CloudCoffeeEvent event = event("catalog.producto.disponible.v1", Map.of(
                "productoId", UUID.randomUUID().toString(),
                "destinatarios", java.util.List.of(UUID.randomUUID().toString())));
        when(historyService.wasSuccessful(event.eventId())).thenReturn(false);

        consumer().consume(event);

        verify(pushService).enqueueRestockEvent(event);
        verify(webSocketPublisher, never()).publish(event);
    }

    @Test
    void redeliveredSuccessfulRestockDoesNotEnqueuePushAgain() {
        CloudCoffeeEvent event = event("catalog.producto.disponible.v1", Map.of(
                "productoId", UUID.randomUUID().toString(),
                "destinatarios", java.util.List.of(UUID.randomUUID().toString())));
        when(historyService.wasSuccessful(event.eventId())).thenReturn(true);

        consumer().consume(event);

        verify(pushService, never()).enqueueRestockEvent(event);
        verify(webSocketPublisher, never()).publish(event);
    }

    private NotificationEventConsumer consumer() {
        return new NotificationEventConsumer(historyService, emailService, webSocketPublisher, pushService);
    }

    private static CloudCoffeeEvent event(String eventType, Map<String, Object> payload) {
        return new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "trace-push-routing", eventType, payload);
    }
}
