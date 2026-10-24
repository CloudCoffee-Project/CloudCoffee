package cl.cloudcoffee.catalog_service.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import cl.cloudcoffee.catalog_service.model.entity.StockReservation;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import jakarta.persistence.LockModeType;

public interface StockReservationRepository extends JpaRepository<StockReservation, UUID> {

    Optional<StockReservation> findByOrderIdAndOfferId(UUID orderId, UUID offerId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM StockReservation r WHERE r.orderId = :orderId AND r.offer.id = :offerId")
    Optional<StockReservation> findByOrderIdAndOfferIdForUpdate(
            @Param("orderId") UUID orderId,
            @Param("offerId") UUID offerId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        SELECT r FROM StockReservation r
        WHERE r.offer.id = :offerId
          AND r.status = :status
          AND r.expiresAt <= :now
        ORDER BY r.orderId
        """)
    List<StockReservation> findExpiredForOfferForUpdate(
            @Param("offerId") UUID offerId,
            @Param("status") StockReservationStatus status,
            @Param("now") Instant now);

    @Query("""
        SELECT DISTINCT r.offer.id FROM StockReservation r
        WHERE r.status = :status AND r.expiresAt <= :now
        ORDER BY r.offer.id
        """)
    List<UUID> findExpiredOfferIds(
            @Param("status") StockReservationStatus status,
            @Param("now") Instant now);
}
