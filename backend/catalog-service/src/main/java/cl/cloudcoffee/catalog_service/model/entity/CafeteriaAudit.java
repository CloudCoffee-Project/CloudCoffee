package cl.cloudcoffee.catalog_service.model.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "cafeteria_audit")
@Getter
@Setter
public class CafeteriaAudit {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;
    private UUID cafeteriaId;
    private UUID campusId;
    @Column(nullable = false)
    private String accion;
    private String actorId;
    @Column(length = 1000)
    private String detalle;
    @Column(nullable = false)
    private Instant creadoAt;
}
