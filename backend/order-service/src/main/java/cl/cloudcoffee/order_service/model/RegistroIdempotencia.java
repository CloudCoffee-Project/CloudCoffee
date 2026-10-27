package cl.cloudcoffee.order_service.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/**
 * Primera respuesta terminada de una intención (usuario, método, ruta, clave). Repetir
 * la clave con el mismo cuerpo reproduce exactamente este código, cuerpo y Location.
 */
@Entity
@Table(name = "idempotencia")
public class RegistroIdempotencia {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "usuario_id", nullable = false, updatable = false)
    private UUID usuarioId;

    @Column(nullable = false, length = 10, updatable = false)
    private String metodo;

    @Column(nullable = false, updatable = false)
    private String ruta;

    @Column(nullable = false, updatable = false)
    private UUID clave;

    @Column(name = "hash_cuerpo", nullable = false, length = 64, updatable = false)
    private String hashCuerpo;

    @Column(nullable = false, updatable = false)
    private int status;

    // Columna TEXT: mismo mapeo que product.description en catalog-service.
    @Column(nullable = false, updatable = false)
    private String cuerpo;

    @Column(updatable = false)
    private String location;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected RegistroIdempotencia() {}

    public RegistroIdempotencia(UUID usuarioId, String metodo, String ruta, UUID clave, String hashCuerpo,
            int status, String cuerpo, String location) {
        this.usuarioId = usuarioId;
        this.metodo = metodo;
        this.ruta = ruta;
        this.clave = clave;
        this.hashCuerpo = hashCuerpo;
        this.status = status;
        this.cuerpo = cuerpo;
        this.location = location;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getUsuarioId() { return usuarioId; }
    public String getMetodo() { return metodo; }
    public String getRuta() { return ruta; }
    public UUID getClave() { return clave; }
    public String getHashCuerpo() { return hashCuerpo; }
    public int getStatus() { return status; }
    public String getCuerpo() { return cuerpo; }
    public String getLocation() { return location; }
    public Instant getCreatedAt() { return createdAt; }
}
