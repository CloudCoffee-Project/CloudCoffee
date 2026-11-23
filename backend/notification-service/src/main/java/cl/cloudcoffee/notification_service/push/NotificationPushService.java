package cl.cloudcoffee.notification_service.push;

import cl.cloudcoffee.notification_service.devices.DeviceToken;
import cl.cloudcoffee.notification_service.devices.DeviceTokenRepository;
import cl.cloudcoffee.notification_service.devices.DeviceTokenType;
import cl.cloudcoffee.notification_service.messaging.CloudCoffeeEvent;
import com.google.firebase.ErrorCode;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.MessagingErrorCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class NotificationPushService {

    private static final Logger LOGGER = LoggerFactory.getLogger(NotificationPushService.class);
    private static final String FCM_CHANNEL = "FCM";
    private static final int MAX_ATTEMPTS = 3;
    private static final int MAX_BATCH_SIZE = 20;
    private static final String RESTOCK_EVENT = "catalog.producto.disponible.v1";

    private final DeviceTokenRepository deviceTokenRepository;
    private final NotificationPushDeliveryRepository deliveryRepository;
    private final ObjectProvider<FcmPushGateway> gatewayProvider;

    @Value("${app.fcm.enabled:false}")
    private boolean enabled;

    public NotificationPushService(DeviceTokenRepository deviceTokenRepository,
            NotificationPushDeliveryRepository deliveryRepository,
            ObjectProvider<FcmPushGateway> gatewayProvider) {
        this.deviceTokenRepository = deviceTokenRepository;
        this.deliveryRepository = deliveryRepository;
        this.gatewayProvider = gatewayProvider;
    }

    @Transactional
    public void enqueueOrderEvent(CloudCoffeeEvent event) {
        if (!enabled || !isOrderPushEvent(event.eventType())) {
            return;
        }
        UUID recipient = uuidValue(event.payload().get("clienteId"));
        if (recipient == null) {
            LOGGER.warn("Push omitido por ausencia de cliente autorizado: eventId={}, eventType={}",
                    event.eventId(), event.eventType());
            return;
        }
        DeliveryContent content = orderContent(event);
        enqueueForUser(event, recipient, content);
    }

    @Transactional
    public void enqueueRestockEvent(CloudCoffeeEvent event) {
        if (!enabled || !RESTOCK_EVENT.equals(event.eventType())) {
            return;
        }
        UUID productId = uuidValue(event.payload().get("productoId"));
        List<UUID> recipients = uuidList(event.payload().get("destinatarios"));
        if (productId == null || recipients.isEmpty()) {
            LOGGER.warn("Push de reposición omitido por falta de producto o destinatarios: eventId={}",
                    event.eventId());
            return;
        }
        DeliveryContent content = new DeliveryContent(
                "Producto disponible",
                "El producto que sigues volvió a estar disponible.",
                Map.of("url", "/(cliente)/producto/" + productId,
                        "eventId", event.eventId().toString(),
                        "eventType", event.eventType(),
                        "productoId", productId.toString()));
        recipients.forEach(recipient -> enqueueForUser(event, recipient, content));
    }

    @Transactional
    public void processPending() {
        if (!enabled) {
            return;
        }
        FcmPushGateway gateway = gatewayProvider.getIfAvailable();
        if (gateway == null) {
            throw new IllegalStateException("FCM está habilitado sin un proveedor configurado.");
        }
        Instant now = Instant.now();
        List<NotificationPushDelivery> deliveries =
                deliveryRepository.lockDueDeliveries(now, PageRequest.of(0, MAX_BATCH_SIZE));
        for (NotificationPushDelivery delivery : deliveries) {
            if (!delivery.isDue(now)) {
                continue;
            }
            DeviceToken device = deviceTokenRepository.findById(delivery.getDeviceTokenId()).orElse(null);
            if (device == null || device.getTokenType() != DeviceTokenType.FCM) {
                delivery.markFailed("device_token_missing");
                LOGGER.warn("Push cancelado porque el dispositivo ya no está registrado: eventId={}, deviceId={}",
                        delivery.getEventId(), delivery.getDeviceTokenId());
                continue;
            }
            deliver(gateway, delivery, device);
        }
    }

    private void enqueueForUser(CloudCoffeeEvent event, UUID recipient, DeliveryContent content) {
        for (DeviceToken device : deviceTokenRepository.findAllByUserIdAndTokenType(recipient, DeviceTokenType.FCM)) {
            if (deliveryRepository.existsByEventIdAndChannelAndDeviceTokenId(
                    event.eventId(), FCM_CHANNEL, device.getId())) {
                continue;
            }
            UUID deliveryId = UUID.nameUUIDFromBytes((event.eventId() + ":" + FCM_CHANNEL + ":" + device.getId())
                    .getBytes(StandardCharsets.UTF_8));
            deliveryRepository.save(new NotificationPushDelivery(deliveryId, event.eventId(), device.getId(),
                    content.title(), content.body(), content.data(), Instant.now()));
        }
    }

    private void deliver(FcmPushGateway gateway, NotificationPushDelivery delivery, DeviceToken device) {
        delivery.beginAttempt();
        try {
            gateway.send(device.getToken(), delivery.getTitle(), delivery.getBody(), delivery.getData());
            delivery.markSent();
            LOGGER.info("Push FCM entregado: eventId={}, deliveryId={}, deviceId={}, attempt={}",
                    delivery.getEventId(), delivery.getId(), device.getId(), delivery.getAttemptCount());
        } catch (FirebaseMessagingException exception) {
            MessagingErrorCode errorCode = exception.getMessagingErrorCode();
            ErrorCode firebaseErrorCode = exception.getErrorCode();
            String safeErrorCode = errorCode != null ? errorCode.name()
                    : firebaseErrorCode != null ? firebaseErrorCode.name() : "FCM_ERROR";
            if (errorCode == MessagingErrorCode.UNREGISTERED) {
                deviceTokenRepository.deleteById(device.getId());
                delivery.markFailed("token_unregistered");
                LOGGER.warn("Token FCM inválido eliminado: eventId={}, deliveryId={}, deviceId={}",
                        delivery.getEventId(), delivery.getId(), device.getId());
            } else if (isRetryable(errorCode, firebaseErrorCode)
                    && delivery.getAttemptCount() < MAX_ATTEMPTS) {
                long retryDelaySeconds = 30L << (delivery.getAttemptCount() - 1);
                delivery.scheduleRetry(Instant.now().plusSeconds(retryDelaySeconds), safeErrorCode);
                LOGGER.warn("Fallo FCM transitorio; reintento programado: eventId={}, deliveryId={}, deviceId={}, "
                                + "attempt={}, retryInSeconds={}, errorCode={}",
                        delivery.getEventId(), delivery.getId(), device.getId(), delivery.getAttemptCount(),
                        retryDelaySeconds, safeErrorCode);
            } else {
                delivery.markFailed(safeErrorCode);
                LOGGER.error("Push FCM agotó reintentos o falló permanentemente: eventId={}, deliveryId={}, "
                                + "deviceId={}, attempt={}, errorCode={}",
                        delivery.getEventId(), delivery.getId(), device.getId(), delivery.getAttemptCount(),
                        safeErrorCode);
            }
        }
    }

    private static boolean isRetryable(MessagingErrorCode messagingErrorCode, ErrorCode firebaseErrorCode) {
        return firebaseErrorCode == ErrorCode.INTERNAL
                || firebaseErrorCode == ErrorCode.UNAVAILABLE
                || firebaseErrorCode == ErrorCode.DEADLINE_EXCEEDED
                || firebaseErrorCode == ErrorCode.RESOURCE_EXHAUSTED
                || messagingErrorCode == MessagingErrorCode.INTERNAL
                || messagingErrorCode == MessagingErrorCode.UNAVAILABLE
                || messagingErrorCode == MessagingErrorCode.QUOTA_EXCEEDED;
    }

    private static boolean isOrderPushEvent(String eventType) {
        return switch (eventType) {
            case "order.compra.creada.v1",
                    "order.compra.estado-cambiado.v1",
                    "order.pago.resultado.v1",
                    "order.orden.estado-cambiado.v1",
                    "order.orden.entregada.v1" -> true;
            default -> false;
        };
    }

    private static DeliveryContent orderContent(CloudCoffeeEvent event) {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("eventId", event.eventId().toString());
        data.put("eventType", event.eventType());
        String purchaseId = stringValue(event.payload().get("compraId"));
        String orderId = stringValue(event.payload().get("ordenId"));
        if (purchaseId != null) {
            data.put("compraId", purchaseId);
        }
        if (orderId != null) {
            data.put("ordenId", orderId);
        }
        data.put("url", orderId == null
                ? "/(cliente)/mis-compras"
                : "/(cliente)/orden/" + orderId);

        return switch (event.eventType()) {
            case "order.compra.creada.v1" -> new DeliveryContent(
                    "Compra recibida", "Tu compra está siendo procesada.", data);
            case "order.compra.estado-cambiado.v1" -> new DeliveryContent(
                    "Compra actualizada", "Estado: " + displayState(event.payload().get("estado")), data);
            case "order.pago.resultado.v1" -> new DeliveryContent(
                    "Pago actualizado", "Estado: " + displayState(event.payload().get("estado")), data);
            case "order.orden.entregada.v1" -> new DeliveryContent(
                    "Retiro completado", "Tu pedido fue entregado.", data);
            default -> new DeliveryContent(
                    "Estado de retiro actualizado", "Estado: " + displayState(event.payload().get("estado")), data);
        };
    }

    private static String displayState(Object value) {
        String state = stringValue(value);
        if (state == null) {
            return "actualizado";
        }
        return switch (state) {
            case "listo_para_retiro" -> "Listo para retirar";
            case "pendiente_pago" -> "Pendiente de pago";
            case "pagado" -> "Pago confirmado";
            case "entregado" -> "Retiro completado";
            case "cancelado" -> "Cancelado";
            default -> state;
        };
    }

    private static List<UUID> uuidList(Object value) {
        if (!(value instanceof List<?> values)) {
            return List.of();
        }
        List<UUID> parsed = new ArrayList<>();
        for (Object item : values) {
            UUID recipient = uuidValue(item);
            if (recipient != null) {
                parsed.add(recipient);
            }
        }
        return parsed.stream().distinct().toList();
    }

    private static UUID uuidValue(Object value) {
        String stringValue = stringValue(value);
        if (stringValue == null) {
            return null;
        }
        try {
            return UUID.fromString(stringValue);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private static String stringValue(Object value) {
        if (value instanceof UUID uuid) {
            return uuid.toString();
        }
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        return null;
    }

    private record DeliveryContent(String title, String body, Map<String, String> data) {
    }
}
