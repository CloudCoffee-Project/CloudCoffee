package cl.cloudcoffee.catalog_service.model.entity;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "catalog_audit")
@Getter
@Setter
public class CatalogAudit {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 32)
    private String resourceType;

    @Column(nullable = false)
    private UUID resourceId;

    @Column(nullable = false, length = 32)
    private String action;

    @Column(length = 36)
    private String actorId;

    @Column(length = 1000)
    private String detail;

    @Column(nullable = false)
    private Instant createdAt;
}
