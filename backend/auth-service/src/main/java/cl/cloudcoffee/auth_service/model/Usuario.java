package cl.cloudcoffee.auth_service.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "usuarios")
public class Usuario {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Rol rol;

    @Column(nullable = false)
    private String nombre;

    @Column(nullable = false)
    private String apellido;

    @Column(nullable = false)
    private String telefono;

    @Column(nullable = false)
    private boolean verificado = false;

    @Column(nullable = false)
    private boolean activo = true;

    @Column(nullable = false)
    private boolean eliminado = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    /** INT2-121: versión optimista expuesta a la administración; parte en 1. */
    @Version
    @Column(nullable = false)
    private long version = 1;

    protected Usuario() {}

    public Usuario(String email, String passwordHash, Rol rol, String nombre, String apellido, String telefono) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.rol = rol;
        this.nombre = nombre;
        this.apellido = apellido;
        this.telefono = telefono;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public Rol getRol() { return rol; }
    public String getNombre() { return nombre; }
    public String getApellido() { return apellido; }
    public String getTelefono() { return telefono; }
    public boolean isVerificado() { return verificado; }
    public boolean isActivo() { return activo; }
    public boolean isEliminado() { return eliminado; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public long getVersion() { return version; }

    /** Personal invitado que aún no define su contraseña (o cliente sin verificar su correo). */
    public boolean isPendienteActivacion() { return activo && !eliminado && !verificado; }

    public void verificar() { this.verificado = true; this.updatedAt = Instant.now(); }
    public void desactivar() { this.activo = false; this.updatedAt = Instant.now(); }
    public void reactivar() { this.activo = true; this.updatedAt = Instant.now(); }

    /** Marca un cambio que no toca columnas de la fila (p. ej. la asignación) para incrementar la versión. */
    public void registrarCambio() { this.updatedAt = Instant.now(); }

    /** La persona invitada define su contraseña: la cuenta queda activa y con el correo verificado. */
    public void activarConPassword(String passwordHash) {
        this.passwordHash = passwordHash;
        this.verificado = true;
        this.updatedAt = Instant.now();
    }

    /**
     * Baja irreversible (contrato INT2-109): conserva el id, que Order y Payment usan como referencia
     * pseudónima, y reemplaza los datos personales. El correo anonimizado libera el original.
     */
    public void anonimizar(String passwordHashAleatorio) {
        this.eliminado = true;
        this.activo = false;
        this.email = "eliminado+" + id + "@anonimo.invalid";
        this.nombre = "Usuario";
        this.apellido = "eliminado";
        this.telefono = "000000";
        this.passwordHash = passwordHashAleatorio;
        this.updatedAt = Instant.now();
    }
    public void actualizarPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
        this.updatedAt = Instant.now();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Usuario other)) return false;
        return id != null && id.equals(other.id);
    }

    @Override
    public int hashCode() { return getClass().hashCode(); }
    public void setNombre(String nombre) {
        this.nombre = nombre;
        this.updatedAt = Instant.now();
    }
    public void setApellido(String apellido) {
        this.apellido = apellido;
        this.updatedAt = Instant.now();
    }
    public void setTelefono(String telefono) {
        this.telefono = telefono;
        this.updatedAt = Instant.now();
    }
}
