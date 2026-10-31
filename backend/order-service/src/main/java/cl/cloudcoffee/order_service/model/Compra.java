package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
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

    @Column(name = "monto_total", nullable = false, precision = 12, scale = 2)
    private BigDecimal montoTotal;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private EstadoCompra estado;
    @Column(nullable = false, length = 3, updatable = false)
    private String moneda = "CLP";
    @Column(name = "reserva_expira_at", nullable = false, updatable = false)
    private Instant reservaExpiraAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Version
    @Column(nullable = false)
    private long version;
    @OneToMany(mappedBy = "compra", cascade = CascadeType.PERSIST)
    private List<Orden> ordenes = new ArrayList<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Compra() {}

    public Compra(UUID usuarioId, BigDecimal montoTotal) {
        // Compatibilidad con las compras mínimas usadas por INT2-53/76.
        inicializar(usuarioId, Instant.now());
        if (montoTotal == null || montoTotal.signum() <= 0) {
            throw new IllegalArgumentException("El monto total de la compra debe ser positivo");
        }
        this.montoTotal = MontosClp.validar(montoTotal);
        this.estado = EstadoCompra.PENDIENTE_PAGO;
    }

    /** Nueva compra con snapshots por cafetería; el importe se deriva de sus ítems. */
    public Compra(UUID usuarioId, Instant creadoAt, List<Orden> ordenes) {
        inicializar(usuarioId, creadoAt);
        Objects.requireNonNull(ordenes, "Las órdenes son obligatorias");
        if (ordenes.isEmpty() || ordenes.size() > 100) {
            throw new IllegalArgumentException("Una compra requiere entre 1 y 100 órdenes");
        }
        var cafeterias = new HashSet<UUID>();
        var ofertas = new HashSet<UUID>();
        BigDecimal total = BigDecimal.ZERO;
        boolean revision = false;
        for (Orden orden : ordenes) {
            if (orden == null || orden.estaVinculada() || !cafeterias.add(orden.getCafeteriaId())) {
                throw new IllegalArgumentException("Orden nula, reutilizada o cafetería duplicada");
            }
            for (OrdenItem item : orden.getItems()) {
                if (!ofertas.add(item.getOfertaId()) || ofertas.size() > 100) {
                    throw new IllegalArgumentException("La compra admite hasta 100 ofertas distintas");
                }
            }
            total = total.add(orden.getMontoTotal());
            revision |= orden.getEstado() == EstadoOrden.REVISION_REQUERIDA;
        }
        this.montoTotal = MontosClp.validar(total);
        this.estado = revision ? EstadoCompra.REVISION_REQUERIDA : EstadoCompra.PENDIENTE_PAGO;
        for (Orden orden : ordenes) {
            orden.vincular(this);
            this.ordenes.add(orden);
        }
    }

    private void inicializar(UUID usuarioId, Instant creadoAt) {
        this.usuarioId = Objects.requireNonNull(usuarioId, "La compra requiere un usuario");
        this.createdAt = Objects.requireNonNull(creadoAt, "La fecha es obligatoria").truncatedTo(ChronoUnit.MICROS);
        this.updatedAt = this.createdAt;
        this.reservaExpiraAt = this.createdAt.plusSeconds(15 * 60);
    }

    @PreUpdate
    void actualizarFecha() { updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS); }

    public UUID getId() { return id; }
    public UUID getUsuarioId() { return usuarioId; }
    public BigDecimal getMontoTotal() { return montoTotal; }
    public Instant getCreatedAt() { return createdAt; }
    public EstadoCompra getEstado() { return estado; }
    public String getMoneda() { return moneda; }
    public Instant getReservaExpiraAt() { return reservaExpiraAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public long getVersion() { return version; }
    public List<Orden> getOrdenes() { return List.copyOf(ordenes); }
}
