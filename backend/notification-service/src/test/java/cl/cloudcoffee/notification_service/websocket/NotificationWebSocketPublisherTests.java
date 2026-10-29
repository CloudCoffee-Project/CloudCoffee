package cl.cloudcoffee.notification_service.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.simp.SimpMessagingTemplate;

class NotificationWebSocketPublisherTests {

    private SimpMessagingTemplate messagingTemplate;
    private NotificationOrderAccessRepository orderAccessRepository;
    private NotificationPurchaseAccessRepository purchaseAccessRepository;
    private NotificationWebSocketPublisher publisher;

    @BeforeEach
    void setUp() {
        messagingTemplate = mock(SimpMessagingTemplate.class);
        orderAccessRepository = mock(NotificationOrderAccessRepository.class);
        purchaseAccessRepository = mock(NotificationPurchaseAccessRepository.class);
        publisher = new NotificationWebSocketPublisher(
                messagingTemplate, orderAccessRepository, purchaseAccessRepository);
    }

    @Test
    void publicaCambioDeOrdenAlCompradorYAlPanelDeLaCafeteria() {
        UUID purchaseId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID clientId = UUID.randomUUID();
        UUID cafeteriaId = UUID.randomUUID();
        CloudCoffeeEvent event = event("order.orden.estado-cambiado.v1", Map.of(
                "compraId", purchaseId.toString(),
                "ordenId", orderId.toString(),
                "clienteId", clientId.toString(),
                "cafeteriaId", cafeteriaId.toString(),
                "estado", "listo_para_retiro",
                "version", 3));

        publisher.publish(event);

        ArgumentCaptor<NotificationOrderAccess> orderAccess = ArgumentCaptor.forClass(NotificationOrderAccess.class);
        ArgumentCaptor<NotificationPurchaseAccess> purchaseAccess =
                ArgumentCaptor.forClass(NotificationPurchaseAccess.class);
        verify(orderAccessRepository).save(orderAccess.capture());
        verify(purchaseAccessRepository).save(purchaseAccess.capture());
        assertThat(orderAccess.getValue().getOrderId()).isEqualTo(orderId);
        assertThat(orderAccess.getValue().getPurchaseId()).isEqualTo(purchaseId);
        assertThat(orderAccess.getValue().getClientId()).isEqualTo(clientId);
        assertThat(orderAccess.getValue().getCafeteriaId()).isEqualTo(cafeteriaId);
        assertThat(purchaseAccess.getValue().getPurchaseId()).isEqualTo(purchaseId);
        assertThat(purchaseAccess.getValue().getClientId()).isEqualTo(clientId);
        verify(messagingTemplate).convertAndSend("/topic/orden/" + orderId + "/estado", event);
        verify(messagingTemplate).convertAndSend("/topic/cafeteria/" + cafeteriaId + "/ordenes", event);
    }

    @Test
    void publicaPagoEnDestinoDeCompraYRegistraSuPropietario() {
        UUID purchaseId = UUID.randomUUID();
        UUID clientId = UUID.randomUUID();
        CloudCoffeeEvent event = event("order.pago.resultado.v1", Map.of(
                "compraId", purchaseId.toString(),
                "clienteId", clientId.toString(),
                "estado", "aprobado",
                "version", 2));

        publisher.publish(event);

        verify(purchaseAccessRepository).save(any(NotificationPurchaseAccess.class));
        verify(messagingTemplate).convertAndSend("/topic/compra/" + purchaseId + "/estado", event);
    }

    @Test
    void publicaStockSinAgregarInformacionDeCompradores() {
        UUID cafeteriaId = UUID.randomUUID();
        CloudCoffeeEvent event = event("catalog.stock.actualizado.v1", Map.of(
                "cafeteriaId", cafeteriaId.toString(),
                "stockActual", 10,
                "version", 3));

        publisher.publish(event);

        verify(messagingTemplate).convertAndSend("/topic/cafeteria/" + cafeteriaId + "/stock", event);
    }

    private static CloudCoffeeEvent event(String type, Map<String, Object> payload) {
        return new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "trace-websocket", type, payload);
    }
}
