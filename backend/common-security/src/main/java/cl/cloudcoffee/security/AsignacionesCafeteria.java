package cl.cloudcoffee.security;

import java.util.Optional;
import java.util.UUID;

/**
 * INT2-65 / INT2-50: asignación persistida del personal a su cafetería, cuyo dueño
 * es auth-service. Los demás servicios la consultan por un mecanismo interno
 * autenticado; nunca confían en claims del JWT ni en datos enviados por la UI.
 */
public interface AsignacionesCafeteria {

    /**
     * Cafetería asignada a un CAJERO o ADMIN_CAFETERIA activo; vacío si no tiene.
     *
     * @throws AsignacionNoVerificableException si no se pudo comprobar (la autorización falla cerrada)
     */
    Optional<UUID> cafeteriaDe(UUID usuarioId);
}
