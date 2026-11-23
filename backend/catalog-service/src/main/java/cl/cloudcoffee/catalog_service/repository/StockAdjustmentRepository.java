package cl.cloudcoffee.catalog_service.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import cl.cloudcoffee.catalog_service.model.entity.StockAdjustment;

public interface StockAdjustmentRepository extends JpaRepository<StockAdjustment, UUID> {
    Optional<StockAdjustment> findByOfferIdAndAdjustedByAndIdempotencyKey(
            UUID offerId, UUID adjustedBy, UUID idempotencyKey);
}
