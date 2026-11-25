package cl.cloudcoffee.auth_service.repository;

import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UsuarioRepository extends JpaRepository<Usuario, UUID> {
    Optional<Usuario> findByEmail(String email);
    Optional<Usuario> findByEmailIgnoreCase(String email);
    boolean existsByEmail(String email);
    boolean existsByEmailIgnoreCase(String email);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from Usuario u where u.id = :id")
    Optional<Usuario> findForUpdate(@Param("id") UUID id);

    /** Bloquea a los SUPER_ADMIN activos: dos bajas cruzadas no pueden dejar la plataforma sin ninguno. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from Usuario u where u.rol = :rol and u.activo = true and u.eliminado = false order by u.id")
    List<Usuario> findActivosForUpdate(@Param("rol") Rol rol);

    /**
     * Listado administrativo (INT2-121): excluye cuentas dadas de baja; orden fijo email, id.
     * {@code estado}: null, PENDIENTE (activa sin verificar), ACTIVA o INACTIVA.
     */
    @Query("""
            select u from Usuario u
            where u.eliminado = false
              and (:rol is null or u.rol = :rol)
              and (:estado is null
                   or (:estado = 'PENDIENTE' and u.activo = true and u.verificado = false)
                   or (:estado = 'ACTIVA' and u.activo = true and u.verificado = true)
                   or (:estado = 'INACTIVA' and u.activo = false))
              and (:cafeteriaId is null or exists (
                   select a from AsignacionCafeteria a where a.usuarioId = u.id and a.cafeteriaId = :cafeteriaId))
              and (:q is null or lower(u.email) like :q escape '\\'
                   or lower(u.nombre) like :q escape '\\' or lower(u.apellido) like :q escape '\\')
            order by u.email asc, u.id asc
            """)
    Page<Usuario> buscar(@Param("rol") Rol rol, @Param("estado") String estado,
            @Param("cafeteriaId") UUID cafeteriaId, @Param("q") String q, Pageable pageable);
}
