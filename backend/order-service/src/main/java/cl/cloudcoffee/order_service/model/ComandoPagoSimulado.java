package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** Comando de simulación ya ejecutado, identificado por su clave de idempotencia. */
@Entity
@Table(name = "comandos_pago_simulado")
public class ComandoPagoSimulado {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "compra_id", nullable = false, updatable = false)
    private UUID compraId;

    @Column(nullable = false, length = 100, updatable = false)
    private String clave;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "pago_id", nullable = false, updatable = false)
    private Pago pago;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20, updatable = false)
    private EscenarioPago escenario;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected ComandoPagoSimulado() {}

    public ComandoPagoSimulado(UUID compraId, String clave, Pago pago, EscenarioPago escenario) {
        this.compraId = compraId;
        this.clave = clave;
        this.pago = pago;
        this.escenario = escenario;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getCompraId() { return compraId; }
    public String getClave() { return clave; }
    public Pago getPago() { return pago; }
    public EscenarioPago getEscenario() { return escenario; }
    public Instant getCreatedAt() { return createdAt; }
}
