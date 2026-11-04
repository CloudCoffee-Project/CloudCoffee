package cl.cloudcoffee.notification_service.websocket;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "notification_purchase_access")
public class NotificationPurchaseAccess {

    @Id
    @Column(name = "purchase_id", nullable = false)
    private UUID purchaseId;

    @Column(name = "client_id", nullable = false)
    private UUID clientId;

    protected NotificationPurchaseAccess() {
    }

    public NotificationPurchaseAccess(UUID purchaseId, UUID clientId) {
        this.purchaseId = purchaseId;
        this.clientId = clientId;
    }

    public UUID getClientId() {
        return clientId;
    }

    public UUID getPurchaseId() {
        return purchaseId;
    }
}
