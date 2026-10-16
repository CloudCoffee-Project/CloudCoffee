package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Unidades de una oferta de catalog-service retenidas para una compra hasta {@code venceEn}. */
@Entity
@Table(name = "reservas")
public class Reserva {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "compra_id", nullable = false, updatable = false)
    private Compra compra;

    @Column(name = "oferta_id", nullable = false, updatable = false)
    private UUID ofertaId;

    @Column(nullable = false, updatable = false)
    private int cantidad;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EstadoReserva estado;

    @Column(name = "vence_en", nullable = false, updatable = false)
    private Instant venceEn;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    protected Reserva() {}

    public Reserva(Compra compra, UUID ofertaId, int cantidad, Instant venceEn) {
        if (cantidad <= 0) {
            throw new IllegalArgumentException("La cantidad reservada debe ser positiva");
        }
        this.compra = Objects.requireNonNull(compra, "La reserva requiere una compra");
        this.ofertaId = Objects.requireNonNull(ofertaId, "La reserva requiere una oferta");
        this.venceEn = Objects.requireNonNull(venceEn, "La reserva requiere un vencimiento");
        this.cantidad = cantidad;
        this.estado = EstadoReserva.ACTIVA;
        this.createdAt = Instant.now();
    }

    public boolean estaVencida(Instant ahora) {
        return estado == EstadoReserva.ACTIVA && !ahora.isBefore(venceEn);
    }

    public void confirmar() {
        cambiarDesdeActiva(EstadoReserva.CONFIRMADA);
    }

    public void liberar() {
        cambiarDesdeActiva(EstadoReserva.LIBERADA);
    }

    private void cambiarDesdeActiva(EstadoReserva destino) {
        if (estado != EstadoReserva.ACTIVA) {
            throw new IllegalStateException("La reserva " + id + " ya está " + estado);
        }
        this.estado = destino;
        this.updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public Compra getCompra() { return compra; }
    public UUID getOfertaId() { return ofertaId; }
    public int getCantidad() { return cantidad; }
    public EstadoReserva getEstado() { return estado; }
    public Instant getVenceEn() { return venceEn; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
