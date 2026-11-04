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

    Optional<StockReservation> findByOrderIdAndOfferIdAndAttemptId(UUID orderId, UUID offerId, UUID attemptId);

    boolean existsByOrderIdAndOfferIdAndStatusIn(UUID orderId, UUID offerId,
            List<StockReservationStatus> statuses);

    @Query("SELECT r.offer.id FROM StockReservation r WHERE r.id = :reservationId")
    Optional<UUID> findOfferIdByReservationId(@Param("reservationId") UUID reservationId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM StockReservation r WHERE r.id = :reservationId")
    Optional<StockReservation> findByIdForUpdate(@Param("reservationId") UUID reservationId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM StockReservation r WHERE r.orderId = :orderId AND r.offer.id = :offerId AND r.attemptId = :attemptId")
    Optional<StockReservation> findByOrderIdAndOfferIdAndAttemptIdForUpdate(
            @Param("orderId") UUID orderId,
            @Param("offerId") UUID offerId,
            @Param("attemptId") UUID attemptId);

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
