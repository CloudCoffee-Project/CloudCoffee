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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EstadoCompra estado;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    protected Compra() {}

    public Compra(UUID usuarioId, BigDecimal montoTotal) {
        Objects.requireNonNull(usuarioId, "La compra requiere un usuario");
        if (montoTotal == null || montoTotal.signum() <= 0) {
            throw new IllegalArgumentException("El monto total de la compra debe ser positivo");
        }
        this.usuarioId = usuarioId;
        this.montoTotal = montoTotal;
        this.estado = EstadoCompra.PENDIENTE_PAGO;
        this.createdAt = Instant.now();
    }

    /** Cierra la compra con el estado final indicado; solo una compra pendiente de pago cambia. */
    public void cerrar(EstadoCompra destino) {
        if (estado != EstadoCompra.PENDIENTE_PAGO || destino == EstadoCompra.PENDIENTE_PAGO) {
            throw new IllegalStateException("La compra " + id + " no puede pasar de " + estado + " a " + destino);
        }
        this.estado = destino;
        this.updatedAt = Instant.now();
    }

    public boolean estaPendienteDePago() {
        return estado == EstadoCompra.PENDIENTE_PAGO;
    }

    public UUID getId() { return id; }
    public UUID getUsuarioId() { return usuarioId; }
    public BigDecimal getMontoTotal() { return montoTotal; }
    public EstadoCompra getEstado() { return estado; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
