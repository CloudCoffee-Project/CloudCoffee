package cl.cloudcoffee.catalog_service.model.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

/** INT2-116: un cliente sigue un producto en una cafetería, o en cualquiera si cafeteria es null. */
@Entity
@Table(name = "product_follow", uniqueConstraints = @UniqueConstraint(
        name = "uq_product_follow_user_product_cafeteria", columnNames = {"user_id", "product_id", "cafeteria_key"}))
@Getter
@Setter
public class ProductFollow {

    /** Valor de cafeteria_key para el seguimiento general (sin cafetería). */
    public static final UUID GENERAL = new UUID(0, 0);

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "product_id", nullable = false, updatable = false)
    private Product product;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cafeteria_id", updatable = false)
    private Cafeteria cafeteria;

    @Column(name = "cafeteria_key", nullable = false, updatable = false)
    private UUID cafeteriaKey;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    public static UUID claveDe(UUID cafeteriaId) {
        return cafeteriaId == null ? GENERAL : cafeteriaId;
    }

    public boolean activo() {
        return deletedAt == null;
    }
}
