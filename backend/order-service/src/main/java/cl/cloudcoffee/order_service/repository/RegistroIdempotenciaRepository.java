package cl.cloudcoffee.order_service.repository;

import cl.cloudcoffee.order_service.model.RegistroIdempotencia;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface RegistroIdempotenciaRepository extends JpaRepository<RegistroIdempotencia, UUID> {

    Optional<RegistroIdempotencia> findByUsuarioIdAndMetodoAndRutaAndClave(
            UUID usuarioId, String metodo, String ruta, UUID clave);
}
