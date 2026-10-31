package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Entity
@Table(name = "ordenes")
public class Orden {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "compra_id", nullable = false, updatable = false)
    private Compra compra;
    @Column(name = "codigo_orden", nullable = false, length = 64, updatable = false)
    private String codigoOrden;
    @Column(name = "cafeteria_id", nullable = false, updatable = false)
    private UUID cafeteriaId;
    @Column(name = "cafeteria_nombre", nullable = false, updatable = false)
    private String cafeteriaNombre;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private EstadoOrden estado;
    @Column(name = "monto_total", nullable = false, precision = 12, scale = 2)
    private BigDecimal montoTotal;
    @Column(nullable = false, length = 3, updatable = false)
    private String moneda = "CLP";
    @Column(name = "reserva_expira_at", nullable = false, updatable = false)
    private Instant reservaExpiraAt;
    @Column(name = "retiro_hasta")
    private Instant retiroHasta;
    @Column(name = "entregado_at")
    private Instant entregadoAt;
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    @Version
    @Column(nullable = false)
    private long version;

    @OneToMany(mappedBy = "orden", cascade = CascadeType.PERSIST)
    private List<OrdenItem> items = new ArrayList<>();

    protected Orden() {}

    /** La cotización ya fue validada por el servidor; INT2-71 resolverá las reservas. */
    public Orden(String codigoOrden, UUID cafeteriaId, String cafeteriaNombre,
            EstadoOrden estado, List<OrdenItem> items) {
        if (codigoOrden == null || codigoOrden.isBlank() || codigoOrden.length() > 64
                || cafeteriaNombre == null || cafeteriaNombre.isBlank() || cafeteriaNombre.length() > 255) {
            throw new IllegalArgumentException("Código de orden o nombre de cafetería inválido");
        }
        if (estado != EstadoOrden.REVISION_REQUERIDA && estado != EstadoOrden.PENDIENTE_PAGO) {
            throw new IllegalArgumentException("Una orden nueva debe estar en revisión o pendiente de pago");
        }
        Objects.requireNonNull(items, "Los ítems son obligatorios");
        if (items.isEmpty() || items.size() > 100) {
            throw new IllegalArgumentException("Una orden requiere entre 1 y 100 ítems");
        }
        var ofertas = new HashSet<UUID>();
        BigDecimal total = BigDecimal.ZERO;
        for (OrdenItem item : items) {
            if (item == null || item.estaVinculado() || !ofertas.add(item.getOfertaId())) {
                throw new IllegalArgumentException("Ítem nulo, reutilizado u oferta duplicada");
            }
            total = total.add(item.getSubtotal());
        }
        this.cafeteriaId = Objects.requireNonNull(cafeteriaId, "La cafetería es obligatoria");
        this.montoTotal = MontosClp.validar(total);
        this.codigoOrden = codigoOrden;
        this.cafeteriaNombre = cafeteriaNombre;
        this.estado = estado;
        for (OrdenItem item : items) {
            item.vincular(this);
            this.items.add(item);
        }
    }

    void vincular(Compra compra) {
        if (this.compra != null) {
            throw new IllegalArgumentException("La orden ya pertenece a una compra");
        }
        this.compra = compra;
        this.createdAt = compra.getCreatedAt();
        this.updatedAt = createdAt;
        this.reservaExpiraAt = compra.getReservaExpiraAt();
    }

    @PreUpdate
    void actualizarFecha() { updatedAt = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS); }

    boolean estaVinculada() { return compra != null; }
    public UUID getId() { return id; }
    public Compra getCompra() { return compra; }
    public String getCodigoOrden() { return codigoOrden; }
    public UUID getCafeteriaId() { return cafeteriaId; }
    public String getCafeteriaNombre() { return cafeteriaNombre; }
    public EstadoOrden getEstado() { return estado; }
    public BigDecimal getMontoTotal() { return montoTotal; }
    public String getMoneda() { return moneda; }
    public Instant getReservaExpiraAt() { return reservaExpiraAt; }
    public Instant getRetiroHasta() { return retiroHasta; }
    public Instant getEntregadoAt() { return entregadoAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public long getVersion() { return version; }
    public List<OrdenItem> getItems() { return List.copyOf(items); }
}
