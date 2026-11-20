package cl.cloudcoffee.notification_service.push;

import cl.cloudcoffee.notification_service.devices.DevicePlatform;
import cl.cloudcoffee.notification_service.devices.DeviceToken;
import cl.cloudcoffee.notification_service.devices.DeviceTokenRepository;
import cl.cloudcoffee.notification_service.devices.DeviceTokenType;
import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import com.google.firebase.ErrorCode;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.MessagingErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class NotificationPushServiceTests {

    @Mock DeviceTokenRepository deviceTokenRepository;
    @Mock NotificationPushDeliveryRepository deliveryRepository;
    @Mock ObjectProvider<FcmPushGateway> gatewayProvider;
    @Mock FcmPushGateway gateway;

    private NotificationPushService service;

    @BeforeEach
    void setUp() {
        service = new NotificationPushService(deviceTokenRepository, deliveryRepository, gatewayProvider);
        ReflectionTestUtils.setField(service, "enabled", true);
    }

    @Test
    void enqueuesOnlyForAuthorizedBuyerFcmDevicesWithMobileNavigationData() {
        UUID buyerId = UUID.randomUUID();
        UUID deviceId = UUID.randomUUID();
        String orderId = UUID.randomUUID().toString();
        DeviceToken device = fcmDevice(deviceId, buyerId, "fcm-secret");
        when(deviceTokenRepository.findAllByUserIdAndTokenType(buyerId, DeviceTokenType.FCM))
                .thenReturn(List.of(device));
        CloudCoffeeEvent event = event("order.orden.estado-cambiado.v1", Map.of(
                "clienteId", buyerId.toString(),
                "compraId", UUID.randomUUID().toString(),
                "ordenId", orderId,
                "estado", "listo_para_retiro"));

        service.enqueueOrderEvent(event);

        ArgumentCaptor<NotificationPushDelivery> delivery = ArgumentCaptor.forClass(NotificationPushDelivery.class);
        verify(deliveryRepository).save(delivery.capture());
        assertThat(delivery.getValue().getDeviceTokenId()).isEqualTo(deviceId);
        assertThat(delivery.getValue().getData())
                .containsEntry("url", "/(cliente)/orden/" + orderId)
                .containsEntry("eventId", event.eventId().toString())
                .containsEntry("ordenId", orderId);
        verify(deviceTokenRepository).findAllByUserIdAndTokenType(buyerId, DeviceTokenType.FCM);
    }

    @Test
    void duplicateEventChannelAndDeviceDoesNotCreateAnotherDelivery() {
        UUID buyerId = UUID.randomUUID();
        DeviceToken device = fcmDevice(UUID.randomUUID(), buyerId, "fcm-secret");
        when(deviceTokenRepository.findAllByUserIdAndTokenType(buyerId, DeviceTokenType.FCM))
                .thenReturn(List.of(device));
        CloudCoffeeEvent event = event("order.compra.creada.v1", Map.of("clienteId", buyerId.toString()));
        when(deliveryRepository.existsByEventIdAndChannelAndDeviceTokenId(
                event.eventId(), "FCM", device.getId())).thenReturn(true);

        service.enqueueOrderEvent(event);

        verify(deliveryRepository, never()).save(any(NotificationPushDelivery.class));
    }

    @Test
    void stockGeneralNoEncolaPushYReposicionUsaSoloLosDestinatariosDelEvento() {
        UUID followerId = UUID.randomUUID();
        UUID productId = UUID.randomUUID();
        DeviceToken followerDevice = fcmDevice(UUID.randomUUID(), followerId, "fcm-secret");
        when(deviceTokenRepository.findAllByUserIdAndTokenType(followerId, DeviceTokenType.FCM))
                .thenReturn(List.of(followerDevice));

        service.enqueueOrderEvent(event("catalog.stock.actualizado.v1", Map.of(
                "productoId", productId.toString(), "stockActual", 4)));
        verify(deviceTokenRepository, never()).findAllByUserIdAndTokenType(any(), any());
        verify(deliveryRepository, never()).save(any(NotificationPushDelivery.class));

        service.enqueueRestockEvent(event("catalog.producto.disponible.v1", Map.of(
                "productoId", productId.toString(),
                "destinatarios", List.of(followerId.toString(), followerId.toString()))));

        ArgumentCaptor<NotificationPushDelivery> delivery = ArgumentCaptor.forClass(NotificationPushDelivery.class);
        verify(deliveryRepository).save(delivery.capture());
        assertThat(delivery.getValue().getData())
                .containsEntry("url", "/(cliente)/producto/" + productId)
                .containsEntry("productoId", productId.toString());
        verify(deviceTokenRepository).findAllByUserIdAndTokenType(followerId, DeviceTokenType.FCM);
    }

    @Test
    void unregisteredTokenIsDeletedWithoutPropagatingFcmFailure() throws Exception {
        UUID deviceId = UUID.randomUUID();
        DeviceToken device = fcmDevice(deviceId, UUID.randomUUID(), "fcm-secret");
        NotificationPushDelivery delivery = delivery(deviceId);
        FirebaseMessagingException failure = org.mockito.Mockito.mock(FirebaseMessagingException.class);
        when(failure.getMessagingErrorCode()).thenReturn(MessagingErrorCode.UNREGISTERED);
        when(deliveryRepository.lockDueDeliveries(any(), any())).thenReturn(List.of(delivery));
        when(deviceTokenRepository.findById(deviceId)).thenReturn(Optional.of(device));
        when(gatewayProvider.getIfAvailable()).thenReturn(gateway);
        doThrow(failure).when(gateway).send(anyString(), anyString(), anyString(), anyMap());

        service.processPending();

        assertThat(delivery.getStatus()).isEqualTo("FAILED");
        assertThat(delivery.getAttemptCount()).isEqualTo(1);
        verify(deviceTokenRepository).deleteById(deviceId);
    }

    @Test
    void transientFcmFailureRetriesAtMostThreeTimes() throws Exception {
        UUID deviceId = UUID.randomUUID();
        DeviceToken device = fcmDevice(deviceId, UUID.randomUUID(), "fcm-secret");
        NotificationPushDelivery delivery = delivery(deviceId);
        FirebaseMessagingException failure = org.mockito.Mockito.mock(FirebaseMessagingException.class);
        when(failure.getErrorCode()).thenReturn(ErrorCode.UNAVAILABLE);
        when(deliveryRepository.lockDueDeliveries(any(), any())).thenReturn(List.of(delivery));
        when(deviceTokenRepository.findById(deviceId)).thenReturn(Optional.of(device));
        when(gatewayProvider.getIfAvailable()).thenReturn(gateway);
        doThrow(failure).when(gateway).send(anyString(), anyString(), anyString(), anyMap());

        service.processPending();
        ReflectionTestUtils.setField(delivery, "nextAttemptAt", Instant.EPOCH);
        service.processPending();
        ReflectionTestUtils.setField(delivery, "nextAttemptAt", Instant.EPOCH);
        service.processPending();

        assertThat(delivery.getStatus()).isEqualTo("FAILED");
        assertThat(delivery.getAttemptCount()).isEqualTo(3);
        verify(gateway, times(3)).send(anyString(), anyString(), anyString(), anyMap());
    }

    private static CloudCoffeeEvent event(String eventType, Map<String, Object> payload) {
        return new CloudCoffeeEvent(UUID.randomUUID(), Instant.now(), "trace-push", eventType, payload);
    }

    private static DeviceToken fcmDevice(UUID deviceId, UUID userId, String token) {
        DeviceToken device = new DeviceToken(token, UUID.randomUUID().toString(), userId,
                DevicePlatform.ANDROID, DeviceTokenType.FCM, Instant.now());
        ReflectionTestUtils.setField(device, "id", deviceId);
        return device;
    }

    private static NotificationPushDelivery delivery(UUID deviceId) {
        return new NotificationPushDelivery(UUID.randomUUID(), UUID.randomUUID(), deviceId,
                "Compra", "Estado actualizado", Map.of("url", "/(cliente)/mis-compras"), Instant.now());
    }
}
