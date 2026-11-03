package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Intento de pago de una compra ante un proveedor (por ahora, el simulado). */
@Entity
@Table(name = "pagos")
public class Pago {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "compra_id", nullable = false, updatable = false)
    private Compra compra;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EstadoPago estado;

    @Column(nullable = false, precision = 12, scale = 2, updatable = false)
    private BigDecimal monto;

    @Column(nullable = false, length = 30, updatable = false)
    private String proveedor;

    @Column(name = "referencia_proveedor", length = 100)
    private String referenciaProveedor;

    @Column(name = "motivo_rechazo")
    private String motivoRechazo;

    // INT2-76: motivo del estado según el contrato (aprobacion_simulada, rechazo_simulado, ...).
    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private MotivoPago motivo;

    // Bloqueo optimista: dos resultados concurrentes no pueden sobrescribirse.
    @Version
    @Column(nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    protected Pago() {}

    /** El monto se toma de la compra: el cliente nunca lo informa. */
    public Pago(Compra compra, String proveedor, String referenciaProveedor) {
        this.compra = Objects.requireNonNull(compra, "El pago requiere una compra");
        this.proveedor = Objects.requireNonNull(proveedor, "El pago requiere un proveedor");
        this.referenciaProveedor = referenciaProveedor;
        this.monto = compra.getMontoTotal();
        this.estado = EstadoPago.PENDIENTE;
        this.createdAt = ahora();
    }

    /**
     * Aplica el resultado informado por el proveedor. Repetir el mismo resultado no
     * tiene efecto y devuelve false; cualquier otro cambio sobre un estado final
     * lanza {@link TransicionPagoInvalidaException}.
     */
    public boolean aplicarResultado(EstadoPago resultado, String motivoRechazo) {
        Objects.requireNonNull(resultado, "El resultado del pago es obligatorio");
        if (resultado == estado && estado.esFinal()) {
            return false;
        }
        if (!estado.puedeTransicionarA(resultado)) {
            throw new TransicionPagoInvalidaException(estado, resultado);
        }
        this.estado = resultado;
        this.motivoRechazo = resultado == EstadoPago.RECHAZADO ? motivoRechazo : null;
        this.updatedAt = ahora();
        return true;
    }

    // Precisión de la base (microsegundos): la respuesta y las lecturas posteriores coinciden.
    private static Instant ahora() {
        return Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
    }

    public void registrarMotivo(MotivoPago motivo) {
        this.motivo = Objects.requireNonNull(motivo, "El motivo del pago es obligatorio");
    }

    public UUID getId() { return id; }
    public MotivoPago getMotivo() { return motivo; }
    public Compra getCompra() { return compra; }
    public EstadoPago getEstado() { return estado; }
    public BigDecimal getMonto() { return monto; }
    public String getProveedor() { return proveedor; }
    public String getReferenciaProveedor() { return referenciaProveedor; }
    public String getMotivoRechazo() { return motivoRechazo; }
    public long getVersion() { return version; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
