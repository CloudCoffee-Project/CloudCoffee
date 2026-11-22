package cl.cloudcoffee.catalog_service.repository;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import cl.cloudcoffee.catalog_service.model.entity.CafeteriaAudit;

public interface CafeteriaAuditRepository extends JpaRepository<CafeteriaAudit, UUID> {}
