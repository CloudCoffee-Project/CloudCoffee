package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Compra de un usuario; su monto total lo calcula siempre el servidor. */
@Entity
@Table(name = "compras")
public class Compra {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "usuario_id", nullable = false, updatable = false)
    private UUID usuarioId;

    @Column(name = "monto_total", nullable = false, precision = 10, scale = 2)
    private BigDecimal montoTotal;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Compra() {}

    public Compra(UUID usuarioId, BigDecimal montoTotal) {
        Objects.requireNonNull(usuarioId, "La compra requiere un usuario");
        if (montoTotal == null || montoTotal.signum() <= 0) {
            throw new IllegalArgumentException("El monto total de la compra debe ser positivo");
        }
        this.usuarioId = usuarioId;
        this.montoTotal = montoTotal;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getUsuarioId() { return usuarioId; }
    public BigDecimal getMontoTotal() { return montoTotal; }
    public Instant getCreatedAt() { return createdAt; }
}
