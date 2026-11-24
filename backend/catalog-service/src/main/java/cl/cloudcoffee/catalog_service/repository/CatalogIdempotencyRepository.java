package cl.cloudcoffee.catalog_service.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import cl.cloudcoffee.catalog_service.model.entity.CatalogIdempotency;

public interface CatalogIdempotencyRepository extends JpaRepository<CatalogIdempotency, UUID> {
    Optional<CatalogIdempotency> findByResourceTypeAndActorIdAndIdempotencyKey(
            String resourceType, String actorId, UUID idempotencyKey);
}
