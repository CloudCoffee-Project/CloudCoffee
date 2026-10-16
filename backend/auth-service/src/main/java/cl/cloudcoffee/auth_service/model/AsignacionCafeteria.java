package cl.cloudcoffee.auth_service.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** Cafetería que opera un cajero o administrador; el UUID pertenece a catalog-service. */
@Entity
@Table(name = "asignaciones_cafeteria")
public class AsignacionCafeteria {

    @Id
    @Column(name = "usuario_id")
    private UUID usuarioId;

    @Column(name = "cafeteria_id", nullable = false)
    private UUID cafeteriaId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected AsignacionCafeteria() {}

    public AsignacionCafeteria(UUID usuarioId, UUID cafeteriaId) {
        this.usuarioId = usuarioId;
        this.cafeteriaId = cafeteriaId;
        this.createdAt = Instant.now();
    }

    public UUID getUsuarioId() { return usuarioId; }
    public UUID getCafeteriaId() { return cafeteriaId; }
    public Instant getCreatedAt() { return createdAt; }
}
