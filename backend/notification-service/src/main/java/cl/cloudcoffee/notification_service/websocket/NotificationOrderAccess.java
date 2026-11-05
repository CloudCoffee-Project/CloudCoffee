package cl.cloudcoffee.notification_service.websocket;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "notification_order_access")
public class NotificationOrderAccess {

    @Id
    @Column(name = "order_id", nullable = false)
    private UUID orderId;

    @Column(name = "purchase_id", nullable = false)
    private UUID purchaseId;

    @Column(name = "client_id", nullable = false)
    private UUID clientId;

    @Column(name = "cafeteria_id", nullable = false)
    private UUID cafeteriaId;

    protected NotificationOrderAccess() {
    }

    public NotificationOrderAccess(UUID orderId, UUID purchaseId, UUID clientId, UUID cafeteriaId) {
        this.orderId = orderId;
        this.purchaseId = purchaseId;
        this.clientId = clientId;
        this.cafeteriaId = cafeteriaId;
    }

    public UUID getPurchaseId() {
        return purchaseId;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public UUID getClientId() {
        return clientId;
    }

    public UUID getCafeteriaId() {
        return cafeteriaId;
    }
}
