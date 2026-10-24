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
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "stock_adjustment")
@Getter
@Setter
public class StockAdjustment {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "offer_id", nullable = false)
    private Offer offer;

    @Column(name = "adjusted_by", nullable = false)
    private UUID adjustedBy;

    @Column(nullable = false)
    private Integer quantity;

    @Column(name = "reserved_quantity", nullable = false)
    private Long reservedQuantity;

    @Column(name = "previous_stock", nullable = false)
    private Integer previousStock;

    @Column(nullable = false)
    private Integer stock;

    @Column(nullable = false)
    private Long version;

    @Column(name = "adjusted_at", nullable = false)
    private Instant adjustedAt;
}
