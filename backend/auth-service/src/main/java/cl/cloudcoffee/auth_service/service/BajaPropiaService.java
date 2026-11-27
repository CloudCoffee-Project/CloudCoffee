package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

/**
 * {@code POST /auth/users/me/baja} (INT2-129, contrato INT2-109). Solo CLIENTE; la cuenta sale del
 * {@code sub} del JWT firmado, nunca de un id enviado por el cliente.
 *
 * <ol>
 *   <li>Confirma la identidad con la contraseña actual: si no coincide, 401 CONTRASENA_INCORRECTA.</li>
 *   <li>Pregunta a Order por compras sin cerrar: si hay, 409 COMPRAS_EN_CURSO; si Order no responde,
 *       503 OPERACION_PENDIENTE. En ambos casos no cambia nada y basta con reintentar más tarde.</li>
 *   <li>Anonimiza la cuenta con la misma regla que la baja administrativa.</li>
 * </ol>
 * Repetir la baja de una cuenta ya anonimizada responde igual (204) y vuelve a publicar el evento, cuyos
 * consumidores son idempotentes: así se recupera una publicación perdida.
 */
@Service
public class BajaPropiaService {

    private final UsuarioRepository usuarios;
    private final PasswordEncoder passwordEncoder;
    private final ComprasEnCurso comprasEnCurso;
    private final AnonimizacionCuentas anonimizacion;
    private final TransactionTemplate tx;

    public BajaPropiaService(UsuarioRepository usuarios, PasswordEncoder passwordEncoder,
            ComprasEnCurso comprasEnCurso, AnonimizacionCuentas anonimizacion,
            PlatformTransactionManager transactionManager) {
        this.usuarios = usuarios;
        this.passwordEncoder = passwordEncoder;
        this.comprasEnCurso = comprasEnCurso;
        this.anonimizacion = anonimizacion;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public void darDeBaja(Jwt jwt, String passwordActual) {
        if (!Rol.CLIENTE.name().equals(jwt.getClaimAsString("role"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                    "Rol no permitido", "Solo un cliente puede dar de baja su propia cuenta; el personal lo gestiona su administrador.",
                    "ROL_NO_PERMITIDO");
        }
        UUID usuarioId = usuarioId(jwt);

        // Una baja ya hecha es idempotente: no exige la contraseña (ya no existe) y repone el evento.
        Boolean yaEliminada = tx.execute(status -> {
            Usuario usuario = usuarios.findById(usuarioId).orElseThrow(BajaPropiaService::cuentaNoValida);
            if (!usuario.isEliminado()) return false;
            anonimizacion.republicar(usuario, AnonimizacionCuentas.ORIGEN_PROPIA);
            return true;
        });
        if (Boolean.TRUE.equals(yaEliminada)) return;

        tx.executeWithoutResult(status -> verificarIdentidad(usuarios.findById(usuarioId)
                .orElseThrow(BajaPropiaService::cuentaNoValida), passwordActual));

        // Fuera de la transacción: no se mantiene la fila bloqueada mientras se espera a Order.
        long abiertas = comprasEnCurso.contar(usuarioId);
        if (abiertas > 0) throw AnonimizacionCuentas.comprasEnCurso(abiertas);

        try {
            tx.executeWithoutResult(status -> {
                Usuario usuario = usuarios.findForUpdate(usuarioId).orElseThrow(BajaPropiaService::cuentaNoValida);
                if (usuario.isEliminado()) return; // Otra solicitud concurrente ya la completó.
                verificarIdentidad(usuario, passwordActual);
                anonimizacion.anonimizar(usuario, AnonimizacionCuentas.ORIGEN_PROPIA);
            });
        } catch (ObjectOptimisticLockingFailureException carrera) {
            // Otra solicitud cambió la cuenta a la vez. Si fue esta misma baja, el resultado es el esperado.
            boolean eliminada = Boolean.TRUE.equals(tx.execute(status ->
                    usuarios.findById(usuarioId).map(Usuario::isEliminado).orElse(false)));
            if (!eliminada) throw carrera;
        }
    }

    private void verificarIdentidad(Usuario usuario, String passwordActual) {
        if (usuario.getRol() != Rol.CLIENTE) throw cuentaNoValida();
        if (!usuario.isActivo()) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/estado-invalido"),
                    "Estado inválido", "La cuenta está desactivada.", "ESTADO_INVALIDO");
        }
        if (passwordActual == null || !passwordEncoder.matches(passwordActual, usuario.getPasswordHash())) {
            throw new BusinessException(HttpStatus.UNAUTHORIZED, URI.create("/problems/contrasena-incorrecta"),
                    "Contraseña incorrecta", "La contraseña actual no coincide.", "CONTRASENA_INCORRECTA");
        }
    }

    private static UUID usuarioId(Jwt jwt) {
        try {
            return UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException | NullPointerException error) {
            throw cuentaNoValida();
        }
    }

    private static BusinessException cuentaNoValida() {
        return new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/usuario-invalido"),
                "Usuario inválido", "El token no identifica a una cuenta de cliente válida.", "USUARIO_INVALIDO");
    }
}
