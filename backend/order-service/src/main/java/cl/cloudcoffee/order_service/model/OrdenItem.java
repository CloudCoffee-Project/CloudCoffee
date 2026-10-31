package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.Objects;
import java.util.UUID;

/** Snapshot por valor: no hay joins ni claves foráneas hacia Catalog. */
@Entity
@Table(name = "orden_items")
public class OrdenItem {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "orden_id", nullable = false, updatable = false)
    private Orden orden;

    @Column(name = "oferta_id", nullable = false, updatable = false)
    private UUID ofertaId;
    @Column(name = "producto_id", nullable = false, updatable = false)
    private UUID productoId;
    @Column(name = "producto_nombre", nullable = false, updatable = false)
    private String productoNombre;
    @Column(nullable = false, updatable = false)
    private int cantidad;
    @Column(name = "precio_unitario", nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal precioUnitario;
    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal subtotal;

    protected OrdenItem() {}

    public OrdenItem(UUID ofertaId, UUID productoId, String productoNombre, int cantidad, BigDecimal precioUnitario) {
        this.ofertaId = Objects.requireNonNull(ofertaId, "La oferta es obligatoria");
        this.productoId = Objects.requireNonNull(productoId, "El producto es obligatorio");
        if (productoNombre == null || productoNombre.isBlank() || productoNombre.length() > 255) {
            throw new IllegalArgumentException("El nombre del producto debe tener entre 1 y 255 caracteres");
        }
        if (cantidad < 1 || cantidad > 100) {
            throw new IllegalArgumentException("La cantidad debe estar entre 1 y 100");
        }
        this.productoNombre = productoNombre;
        this.cantidad = cantidad;
        this.precioUnitario = MontosClp.validar(precioUnitario);
        this.subtotal = MontosClp.validar(precioUnitario.multiply(BigDecimal.valueOf(cantidad)));
    }

    void vincular(Orden orden) {
        if (this.orden != null) {
            throw new IllegalArgumentException("El ítem ya pertenece a una orden");
        }
        this.orden = orden;
    }

    boolean estaVinculado() { return orden != null; }
    public UUID getId() { return id; }
    public UUID getOfertaId() { return ofertaId; }
    public UUID getProductoId() { return productoId; }
    public String getProductoNombre() { return productoNombre; }
    public int getCantidad() { return cantidad; }
    public BigDecimal getPrecioUnitario() { return precioUnitario; }
    public BigDecimal getSubtotal() { return subtotal; }
}
