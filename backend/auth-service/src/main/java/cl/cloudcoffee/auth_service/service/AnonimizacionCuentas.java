package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.time.Instant;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

/**
 * Baja irreversible de una cuenta (contrato INT2-109), común a la baja propia (INT2-129) y a la administrativa
 * (INT2-121). Debe llamarse dentro de una transacción con la cuenta bloqueada.
 *
 * <p>Conserva el {@code usuarioId}, que compras, pagos y auditoría usan como referencia pseudónima, y
 * reemplaza los datos personales. Revoca todos los tokens (login y refresh quedan bloqueados, INT2-105),
 * elimina la asignación y, después del commit, publica {@code auth.usuario.anonimizado.v1} para que
 * Notification retire dispositivos e historial y Catalog retire seguimientos.
 */
@Component
public class AnonimizacionCuentas {

    private static final Logger LOGGER = LoggerFactory.getLogger(AnonimizacionCuentas.class);
    public static final String ORIGEN_PROPIA = "baja_propia";
    public static final String ORIGEN_ADMINISTRATIVA = "baja_administrativa";

    private final UsuarioRepository usuarios;
    private final TokenAuthRepository tokens;
    private final AsignacionCafeteriaRepository asignaciones;
    private final AuthEventPublisher eventos;
    private final PasswordEncoder passwordEncoder;

    public AnonimizacionCuentas(UsuarioRepository usuarios, TokenAuthRepository tokens,
            AsignacionCafeteriaRepository asignaciones, AuthEventPublisher eventos, PasswordEncoder passwordEncoder) {
        this.usuarios = usuarios;
        this.tokens = tokens;
        this.asignaciones = asignaciones;
        this.eventos = eventos;
        this.passwordEncoder = passwordEncoder;
    }

    public Usuario anonimizar(Usuario usuario, String origen) {
        if (usuario.isEliminado()) return usuario;
        // Nadie conoce este secreto: la cuenta no vuelve a admitir login.
        usuario.anonimizar(passwordEncoder.encode(TokenHasher.generarTokenPlano()));
        tokens.findByUsuarioIdAndRevokedAtIsNull(usuario.getId()).forEach(TokenAuth::revocar);
        asignaciones.findById(usuario.getId()).ifPresent(asignaciones::delete);
        Usuario guardado = usuarios.saveAndFlush(usuario);
        publicarDespuesDelCommit(guardado, origen);
        return guardado;
    }

    /**
     * Vuelve a publicar el evento de una cuenta ya anonimizada. Sus consumidores son idempotentes, así que
     * repetir la baja recupera una publicación perdida (por ejemplo, si el broker no estaba disponible).
     */
    public void republicar(Usuario usuario, String origen) {
        if (usuario.isEliminado()) publicarDespuesDelCommit(usuario, origen);
    }

    /** Una cuenta CLIENTE con compras sin cerrar no se da de baja: es recuperable reintentando después. */
    public static BusinessException comprasEnCurso(long compras) {
        return new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/compras-en-curso"),
                "Compras en curso", "Hay " + compras + (compras == 1 ? " compra" : " compras")
                        + " sin cerrar. Podrás dar de baja la cuenta cuando terminen o se cancelen.",
                "COMPRAS_EN_CURSO");
    }

    private void publicarDespuesDelCommit(Usuario usuario, String origen) {
        UUID id = usuario.getId();
        Rol rol = usuario.getRol();
        Instant anonimizadoAt = usuario.getUpdatedAt() == null ? Instant.now() : usuario.getUpdatedAt();
        String traceId = traceId();
        Runnable publicar = () -> {
            try {
                eventos.publishUsuarioAnonimizado(id.toString(), rol.name(), anonimizadoAt, origen, traceId);
            } catch (RuntimeException error) {
                LOGGER.error("No se pudo publicar la baja de la cuenta {}: {}", id, error.getClass().getSimpleName());
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publicar.run();
                }
            });
        } else {
            publicar.run();
        }
    }

    private static String traceId() {
        String actual = MDC.get("traceId");
        if (actual != null && actual.matches("[0-9a-f]{32}")) return actual;
        return UUID.randomUUID().toString().replace("-", "");
    }
}
