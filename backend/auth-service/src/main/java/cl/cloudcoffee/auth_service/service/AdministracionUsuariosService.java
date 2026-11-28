package cl.cloudcoffee.auth_service.service;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import cl.cloudcoffee.auth_service.dto.CambiarAsignacionRequest;
import cl.cloudcoffee.auth_service.dto.CrearPersonalRequest;
import cl.cloudcoffee.auth_service.dto.EditarUsuarioRequest;
import cl.cloudcoffee.auth_service.dto.PaginaUsuariosResponse;
import cl.cloudcoffee.auth_service.dto.UsuarioAdminResponse;
import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.AsignacionCafeteria;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.TokenAuth;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.errors.BusinessException;

/**
 * Administración global de cuentas por SUPER_ADMIN (INT2-121, contrato INT2-109).
 *
 * <p>El alcance de ADMIN_CAFETERIA sobre los cajeros de su cafetería corresponde a INT2-122; hasta entonces
 * solo SUPER_ADMIN opera estas rutas. La baja de una cuenta CLIENTE consulta antes sus compras en curso a
 * Order (INT2-129).
 *
 * <p>Las llamadas a Catalog se hacen fuera de la transacción; las decisiones se toman con la cuenta
 * bloqueada y su versión comprobada. Los eventos se publican solo después del commit.
 */
@Service
public class AdministracionUsuariosService {

    private static final Logger LOGGER = LoggerFactory.getLogger(AdministracionUsuariosService.class);
    static final Duration VIGENCIA_INVITACION = Duration.ofHours(72);
    static final String OPERACION_CREAR_PERSONAL = "crear_personal";
    private static final Set<Rol> ROLES_PERSONAL = EnumSet.of(Rol.CAJERO, Rol.ADMIN_CAFETERIA);
    private static final Map<String, String> ESTADOS = Map.of(
            "pendiente_activacion", "PENDIENTE", "activa", "ACTIVA", "inactiva", "INACTIVA");

    private final UsuarioRepository usuarios;
    private final AsignacionCafeteriaRepository asignaciones;
    private final TokenAuthRepository tokens;
    private final CatalogoCafeterias catalogo;
    private final AuthEventPublisher eventos;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ComprasEnCurso comprasEnCurso;
    private final AnonimizacionCuentas anonimizacion;

    public AdministracionUsuariosService(UsuarioRepository usuarios, AsignacionCafeteriaRepository asignaciones,
            TokenAuthRepository tokens, CatalogoCafeterias catalogo, AuthEventPublisher eventos,
            PasswordEncoder passwordEncoder, JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
            ComprasEnCurso comprasEnCurso, AnonimizacionCuentas anonimizacion) {
        this.usuarios = usuarios;
        this.asignaciones = asignaciones;
        this.tokens = tokens;
        this.catalogo = catalogo;
        this.eventos = eventos;
        this.passwordEncoder = passwordEncoder;
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(transactionManager);
        this.comprasEnCurso = comprasEnCurso;
        this.anonimizacion = anonimizacion;
    }

    /** Resultado de un alta: {@code replay} si la misma clave ya la había creado. */
    public record Alta(UsuarioAdminResponse usuario, boolean replay) {
    }

    // ------------------------------------------------------------------ consultas

    public PaginaUsuariosResponse listar(Jwt jwt, String rol, String estado, String cafeteriaId, String q,
            String page, String size) {
        tx.execute(status -> actorSuperAdmin(jwt));
        int pagina = entero(page, 0, "page", 0, Integer.MAX_VALUE);
        int tamano = entero(size, 20, "size", 1, 100);
        Rol filtroRol = rol == null ? null : enumerado(rol);
        String filtroEstado = null;
        if (estado != null) {
            filtroEstado = ESTADOS.get(estado);
            if (filtroEstado == null) throw invalida("estado debe ser pendiente_activacion, activa o inactiva.");
        }
        UUID filtroCafeteria = cafeteriaId == null ? null : uuid(cafeteriaId, "cafeteriaId");
        String filtroTexto = null;
        if (q != null) {
            String texto = q.strip();
            if (texto.length() < 2 || texto.length() > 100) throw invalida("q debe tener entre 2 y 100 caracteres.");
            filtroTexto = "%" + texto.toLowerCase(Locale.ROOT)
                    .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        }
        Rol rolFinal = filtroRol;
        String estadoFinal = filtroEstado;
        String textoFinal = filtroTexto;
        return tx.execute(status -> {
            actorSuperAdmin(jwt);
            Page<Usuario> resultado = usuarios.buscar(rolFinal, estadoFinal, filtroCafeteria, textoFinal,
                    PageRequest.of(pagina, tamano));
            Map<UUID, UUID> cafeterias = asignaciones.findByUsuarioIdIn(
                            resultado.getContent().stream().map(Usuario::getId).toList()).stream()
                    .collect(Collectors.toMap(AsignacionCafeteria::getUsuarioId, AsignacionCafeteria::getCafeteriaId));
            List<UsuarioAdminResponse> contenido = resultado.getContent().stream()
                    .map(u -> UsuarioAdminResponse.from(u, cafeteriaVisible(u, cafeterias.get(u.getId()))))
                    .toList();
            return new PaginaUsuariosResponse(contenido, resultado.getNumber(), resultado.getSize(),
                    resultado.getTotalElements(), resultado.getTotalPages(), resultado.isFirst(),
                    resultado.isLast(), resultado.isEmpty());
        });
    }

    public UsuarioAdminResponse ver(Jwt jwt, UUID usuarioId) {
        return tx.execute(status -> {
            actorSuperAdmin(jwt);
            return respuesta(visible(usuarios.findById(usuarioId)));
        });
    }

    // ------------------------------------------------------------------ alta por invitación

    public Alta crearPersonal(Jwt jwt, UUID clave, CrearPersonalRequest solicitud) {
        UUID actor = tx.execute(status -> actorSuperAdmin(jwt).getId());
        if (solicitud.getCafeteriaId() == null) {
            throw invalida("cafeteriaId es obligatorio para SUPER_ADMIN.");
        }
        String email = solicitud.getEmail().toLowerCase(Locale.ROOT);
        String hash = hashCuerpo(solicitud, email);

        // Un replay no vuelve a consultar Catalog ni crea nada.
        Optional<Alta> previa = tx.execute(status -> replay(actor, clave, hash));
        if (previa.isPresent()) return previa.get();

        validarCafeteria(solicitud.getCafeteriaId());
        String traceId = traceId();
        try {
            return tx.execute(status -> {
                Optional<Alta> concurrente = replay(actor, clave, hash);
                if (concurrente.isPresent()) return concurrente.get();
                if (usuarios.existsByEmailIgnoreCase(email)) throw emailRegistrado();

                Usuario usuario = new Usuario(email, passwordInutilizable(), Rol.valueOf(solicitud.getRol()),
                        solicitud.getNombre(), solicitud.getApellido(), solicitud.getTelefono());
                usuario = usuarios.saveAndFlush(usuario);
                asignaciones.save(new AsignacionCafeteria(usuario.getId(), solicitud.getCafeteriaId()));
                jdbc.update("""
                        INSERT INTO idempotencias_admin (actor_id, clave, operacion, hash_cuerpo, usuario_id, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """, actor, clave, OPERACION_CREAR_PERSONAL, hash, usuario.getId(),
                        Timestamp.from(Instant.now()));
                emitirInvitacion(usuario, solicitud.getCafeteriaId(), traceId);
                return new Alta(UsuarioAdminResponse.from(usuario, solicitud.getCafeteriaId()), false);
            });
        } catch (DataIntegrityViolationException carrera) {
            // Otra solicitud con la misma clave o el mismo correo confirmó primero.
            Optional<Alta> ganadora = tx.execute(status -> replay(actor, clave, hash));
            if (ganadora.isPresent()) return ganadora.get();
            if (Boolean.TRUE.equals(tx.execute(status -> usuarios.existsByEmailIgnoreCase(email)))) {
                throw emailRegistrado();
            }
            throw carrera;
        }
    }

    /** Solo cuentas pendientes de activación; revoca el token anterior. */
    public void reenviarInvitacion(Jwt jwt, UUID usuarioId) {
        String traceId = traceId();
        tx.executeWithoutResult(status -> {
            actorSuperAdmin(jwt);
            Usuario usuario = visible(usuarios.findForUpdate(usuarioId));
            UUID cafeteria = asignaciones.findById(usuario.getId()).map(AsignacionCafeteria::getCafeteriaId)
                    .orElse(null);
            if (!usuario.isPendienteActivacion() || !ROLES_PERSONAL.contains(usuario.getRol()) || cafeteria == null) {
                throw estadoInvalido("Solo se reenvía la invitación de personal pendiente de activación.");
            }
            emitirInvitacion(usuario, cafeteria, traceId);
        });
    }

    // ------------------------------------------------------------------ ediciones

    public UsuarioAdminResponse editar(Jwt jwt, UUID usuarioId, EditarUsuarioRequest cambios) {
        return tx.execute(status -> {
            actorSuperAdmin(jwt);
            Usuario usuario = visible(usuarios.findForUpdate(usuarioId));
            exigirVersion(usuario, cambios.getVersion());
            if (cambios.getNombre() != null) usuario.setNombre(cambios.getNombre());
            if (cambios.getApellido() != null) usuario.setApellido(cambios.getApellido());
            if (cambios.getTelefono() != null) usuario.setTelefono(cambios.getTelefono());
            return respuesta(usuarios.saveAndFlush(usuario));
        });
    }

    /** Reasigna la cafetería del personal y revoca sus refresh tokens; rige en la siguiente solicitud. */
    public UsuarioAdminResponse cambiarAsignacion(Jwt jwt, UUID usuarioId, CambiarAsignacionRequest cambio) {
        UsuarioAdminResponse actual = tx.execute(status -> {
            actorSuperAdmin(jwt);
            Usuario usuario = visible(usuarios.findById(usuarioId));
            exigirPersonal(usuario);
            exigirVersion(usuario, cambio.getVersion());
            return respuesta(usuario);
        });
        if (cambio.getCafeteriaId().equals(actual.cafeteriaId())) return actual;

        validarCafeteria(cambio.getCafeteriaId());
        return tx.execute(status -> {
            actorSuperAdmin(jwt);
            Usuario usuario = visible(usuarios.findForUpdate(usuarioId));
            exigirPersonal(usuario);
            exigirVersion(usuario, cambio.getVersion());
            asignaciones.findById(usuario.getId()).ifPresentOrElse(
                    asignacion -> asignacion.reasignar(cambio.getCafeteriaId()),
                    () -> asignaciones.save(new AsignacionCafeteria(usuario.getId(), cambio.getCafeteriaId())));
            revocar(usuario, TipoToken.REFRESH);
            usuario.registrarCambio();
            return respuesta(usuarios.saveAndFlush(usuario));
        });
    }

    // ------------------------------------------------------------------ transiciones

    /** Reversible: la cuenta pierde login, refresh y asignación en la siguiente solicitud. */
    public UsuarioAdminResponse desactivar(Jwt jwt, UUID usuarioId) {
        return tx.execute(status -> {
            Usuario actor = actorSuperAdmin(jwt);
            exigirOtro(actor, usuarioId);
            Usuario usuario = visible(bloquear(usuarioId));
            if (!usuario.isActivo()) return respuesta(usuario);
            protegerUltimoSuperAdmin(usuario);
            usuario.desactivar();
            revocar(usuario, TipoToken.REFRESH);
            return respuesta(usuarios.saveAndFlush(usuario));
        });
    }

    public UsuarioAdminResponse reactivar(Jwt jwt, UUID usuarioId) {
        return tx.execute(status -> {
            Usuario actor = actorSuperAdmin(jwt);
            exigirOtro(actor, usuarioId);
            Usuario usuario = visible(bloquear(usuarioId));
            if (usuario.isActivo()) return respuesta(usuario);
            usuario.reactivar();
            return respuesta(usuarios.saveAndFlush(usuario));
        });
    }

    /**
     * Irreversible: anonimiza la cuenta y conserva su id, que Order y Payment usan como referencia.
     * Repetir sobre una cuenta ya dada de baja devuelve el recurso sin cambios ni eventos.
     */
    public UsuarioAdminResponse darDeBaja(Jwt jwt, UUID usuarioId) {
        // Un CLIENTE solo se da de baja sin compras en curso (mismas reglas que la baja propia, INT2-129).
        // Se consulta a Order fuera de la transacción para no mantener la cuenta bloqueada mientras responde.
        Usuario previo = tx.execute(status -> {
            Usuario actor = actorSuperAdmin(jwt);
            exigirOtro(actor, usuarioId);
            return usuarios.findById(usuarioId).orElseThrow(AdministracionUsuariosService::noEncontrado);
        });
        if (previo.getRol() == Rol.CLIENTE && !previo.isEliminado()) {
            long abiertas = comprasEnCurso.contar(usuarioId);
            if (abiertas > 0) throw AnonimizacionCuentas.comprasEnCurso(abiertas);
        }
        return tx.execute(status -> {
            Usuario actor = actorSuperAdmin(jwt);
            exigirOtro(actor, usuarioId);
            Usuario usuario = bloquear(usuarioId);
            if (usuario.isEliminado()) return UsuarioAdminResponse.from(usuario, null);
            protegerUltimoSuperAdmin(usuario);
            return UsuarioAdminResponse.from(
                    anonimizacion.anonimizar(usuario, AnonimizacionCuentas.ORIGEN_ADMINISTRATIVA), null);
        });
    }

    // ------------------------------------------------------------------ reglas comunes

    /**
     * Solo SUPER_ADMIN (INT2-121). Además del claim, la cuenta debe seguir activa en Auth: una cuenta
     * desactivada pierde la administración en la siguiente solicitud, sin esperar a que venza su JWT.
     */
    private Usuario actorSuperAdmin(Jwt jwt) {
        if (!Rol.SUPER_ADMIN.name().equals(jwt.getClaimAsString("role"))) throw rolNoPermitido();
        UUID id;
        try {
            id = UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException | NullPointerException error) {
            throw rolNoPermitido();
        }
        return usuarios.findById(id)
                .filter(u -> u.getRol() == Rol.SUPER_ADMIN && u.isActivo() && !u.isEliminado())
                .orElseThrow(AdministracionUsuariosService::rolNoPermitido);
    }

    /**
     * Bloquea primero a los SUPER_ADMIN activos (orden fijo) y luego la cuenta: dos administradores que se
     * desactivan mutuamente a la vez se serializan y el segundo recibe ULTIMO_SUPER_ADMIN.
     */
    private Usuario bloquear(UUID usuarioId) {
        // El rol no cambia nunca, así que se lee sin bloquear y sin cargar la entidad: la cuenta se carga
        // por primera vez ya bloqueada y su estado (activo, eliminado) es el vigente.
        List<String> rol = jdbc.queryForList("SELECT rol FROM usuarios WHERE id = ?", String.class, usuarioId);
        if (rol.isEmpty()) throw noEncontrado();
        if (Rol.SUPER_ADMIN.name().equals(rol.get(0))) usuarios.findActivosForUpdate(Rol.SUPER_ADMIN);
        return usuarios.findForUpdate(usuarioId).orElseThrow(AdministracionUsuariosService::noEncontrado);
    }

    private void protegerUltimoSuperAdmin(Usuario usuario) {
        if (usuario.getRol() != Rol.SUPER_ADMIN || !usuario.isActivo()) return;
        if (usuarios.findActivosForUpdate(Rol.SUPER_ADMIN).size() <= 1) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/ultimo-super-admin"),
                    "Último superadministrador", "La plataforma debe conservar al menos un SUPER_ADMIN activo.",
                    "ULTIMO_SUPER_ADMIN");
        }
    }

    private void validarCafeteria(UUID cafeteriaId) {
        CatalogoCafeterias.Cafeteria cafeteria = catalogo.consultar(cafeteriaId)
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                        URI.create("/problems/cafeteria-no-encontrada"), "Cafetería no encontrada",
                        "La cafetería indicada no existe.", "CAFETERIA_NO_ENCONTRADA"));
        if (!cafeteria.activa()) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/cafeteria-dada-de-baja"),
                    "Cafetería dada de baja", "No se puede asignar personal a una cafetería dada de baja.",
                    "CAFETERIA_DADA_DE_BAJA");
        }
    }

    private void emitirInvitacion(Usuario usuario, UUID cafeteriaId, String traceId) {
        tokens.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), TipoToken.ACTIVACION_CUENTA)
                .forEach(TokenAuth::revocar);
        String tokenPlano = TokenHasher.generarTokenPlano();
        Instant expiresAt = Instant.now().plus(VIGENCIA_INVITACION);
        tokens.save(new TokenAuth(usuario, TokenHasher.hash(tokenPlano), expiresAt, TipoToken.ACTIVACION_CUENTA));
        String usuarioId = usuario.getId().toString();
        String email = usuario.getEmail();
        String nombre = usuario.getNombre();
        String rol = usuario.getRol().name();
        // Si la publicación falla, la cuenta queda pendiente y el administrador reenvía la invitación.
        despuesDelCommit(() -> eventos.publishInvitacionPersonal(usuarioId, email, nombre, rol,
                cafeteriaId.toString(), tokenPlano, expiresAt, traceId));
    }

    private Optional<Alta> replay(UUID actor, UUID clave, String hash) {
        List<Map<String, Object>> filas = jdbc.queryForList(
                "SELECT operacion, hash_cuerpo, usuario_id FROM idempotencias_admin WHERE actor_id = ? AND clave = ?",
                actor, clave);
        if (filas.isEmpty()) return Optional.empty();
        Map<String, Object> fila = filas.get(0);
        if (!OPERACION_CREAR_PERSONAL.equals(fila.get("operacion")) || !hash.equals(fila.get("hash_cuerpo"))) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/idempotency-conflict"),
                    "Conflicto de idempotencia", "La Idempotency-Key ya se usó con otro cuerpo.",
                    "IDEMPOTENCY_CONFLICT");
        }
        UUID usuarioId = (UUID) fila.get("usuario_id");
        Usuario usuario = usuarios.findById(usuarioId).orElseThrow();
        UUID cafeteria = asignaciones.findById(usuarioId).map(AsignacionCafeteria::getCafeteriaId).orElse(null);
        return Optional.of(new Alta(UsuarioAdminResponse.from(usuario, cafeteriaVisible(usuario, cafeteria)), true));
    }

    private UsuarioAdminResponse respuesta(Usuario usuario) {
        UUID cafeteria = asignaciones.findById(usuario.getId()).map(AsignacionCafeteria::getCafeteriaId).orElse(null);
        return UsuarioAdminResponse.from(usuario, cafeteriaVisible(usuario, cafeteria));
    }

    /** Una fila de asignación de un CLIENTE o SUPER_ADMIN no se informa (igual que la consulta interna). */
    private static UUID cafeteriaVisible(Usuario usuario, UUID cafeteria) {
        return ROLES_PERSONAL.contains(usuario.getRol()) ? cafeteria : null;
    }

    private void revocar(Usuario usuario, TipoToken tipo) {
        tokens.findByUsuarioIdAndTipoAndRevokedAtIsNull(usuario.getId(), tipo).forEach(TokenAuth::revocar);
    }

    private String passwordInutilizable() {
        // Nadie conoce este secreto: la cuenta no admite login hasta que la persona define su contraseña.
        return passwordEncoder.encode(TokenHasher.generarTokenPlano());
    }

    /** Las cuentas dadas de baja no se listan ni se consultan: 404 igual que una inexistente. */
    private static Usuario visible(Optional<Usuario> usuario) {
        return usuario.filter(u -> !u.isEliminado()).orElseThrow(AdministracionUsuariosService::noEncontrado);
    }

    private static Usuario visible(Usuario usuario) {
        return visible(Optional.of(usuario));
    }

    private static BusinessException noEncontrado() {
        return new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/usuario-no-encontrado"),
                "Usuario no encontrado", "No existe una cuenta con ese identificador.", "USUARIO_NO_ENCONTRADO");
    }

    private static void exigirVersion(Usuario usuario, Long version) {
        if (version == null || usuario.getVersion() != version) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/version-conflicto"),
                    "Versión desactualizada", "La cuenta cambió desde la última lectura. Vuelve a consultarla.",
                    "VERSION_CONFLICTO");
        }
    }

    private static void exigirPersonal(Usuario usuario) {
        if (!ROLES_PERSONAL.contains(usuario.getRol())) {
            throw estadoInvalido("Solo el personal (CAJERO o ADMIN_CAFETERIA) tiene cafetería asignada.");
        }
    }

    private static void exigirOtro(Usuario actor, UUID usuarioId) {
        if (actor.getId().equals(usuarioId)) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/operacion-sobre-si-mismo"),
                    "Operación sobre sí mismo", "Un SUPER_ADMIN no puede desactivar, reactivar ni dar de baja su propia cuenta.",
                    "OPERACION_SOBRE_SI_MISMO");
        }
    }

    private static void despuesDelCommit(Runnable accion) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    accion.run();
                } catch (RuntimeException error) {
                    LOGGER.error("No se pudo publicar el evento de administración de cuentas: {}",
                            error.getClass().getSimpleName());
                }
            }
        });
    }

    /** traceId del contrato (32 hex): el de la traza activa o uno nuevo. */
    private static String traceId() {
        String actual = MDC.get("traceId");
        if (actual != null && actual.matches("[0-9a-f]{32}")) return actual;
        return UUID.randomUUID().toString().replace("-", "");
    }

    private static String hashCuerpo(CrearPersonalRequest solicitud, String email) {
        String canonico = String.join("\u0000", solicitud.getRol(), email, solicitud.getNombre(),
                solicitud.getApellido(), solicitud.getTelefono(), String.valueOf(solicitud.getCafeteriaId()));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonico.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 no disponible", error);
        }
    }

    private static int entero(String valor, int defecto, String nombre, int minimo, int maximo) {
        if (valor == null) return defecto;
        try {
            int numero = Integer.parseInt(valor.strip());
            if (numero >= minimo && numero <= maximo) return numero;
        } catch (NumberFormatException ignored) {
            // Se responde 400 abajo.
        }
        throw invalida(nombre + " debe ser un entero entre " + minimo + " y " + maximo + ".");
    }

    private static Rol enumerado(String rol) {
        try {
            return Rol.valueOf(rol);
        } catch (IllegalArgumentException error) {
            throw invalida("rol debe ser CLIENTE, CAJERO, ADMIN_CAFETERIA o SUPER_ADMIN.");
        }
    }

    private static UUID uuid(String valor, String nombre) {
        try {
            return UUID.fromString(valor);
        } catch (IllegalArgumentException error) {
            throw invalida(nombre + " debe ser un UUID.");
        }
    }

    private static BusinessException invalida(String detalle) {
        return new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/solicitud-invalida"),
                "Solicitud inválida", detalle, "SOLICITUD_INVALIDA");
    }

    private static BusinessException rolNoPermitido() {
        return new BusinessException(HttpStatus.FORBIDDEN, URI.create("/problems/rol-no-permitido"),
                "Rol no permitido", "Solo un SUPER_ADMIN activo puede administrar cuentas.", "ROL_NO_PERMITIDO");
    }

    private static BusinessException estadoInvalido(String detalle) {
        return new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/estado-invalido"),
                "Estado inválido", detalle, "ESTADO_INVALIDO");
    }

    private static BusinessException emailRegistrado() {
        return new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/email-ya-registrado"),
                "Correo ya registrado", "Ya existe una cuenta asociada a este correo electrónico.",
                "EMAIL_YA_REGISTRADO");
    }

}
