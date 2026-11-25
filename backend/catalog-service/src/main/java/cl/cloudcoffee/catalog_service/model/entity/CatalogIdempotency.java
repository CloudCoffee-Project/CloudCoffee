package cl.cloudcoffee.catalog_service.model.entity;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "catalog_idempotency", uniqueConstraints = @UniqueConstraint(
        name = "uq_catalog_idempotency", columnNames = {"resource_type", "actor_id", "idempotency_key"}))
@Getter
@Setter
public class CatalogIdempotency {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 32)
    private String resourceType;

    @Column(nullable = false, length = 36)
    private String actorId;

    @Column(nullable = false)
    private UUID idempotencyKey;

    @Column(nullable = false, length = 64)
    private String requestHash;

    @Column(nullable = false)
    private UUID resourceId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String responseBody;
}
