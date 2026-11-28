package cl.cloudcoffee.auth_service.controller;

import java.net.URI;
import java.util.UUID;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cl.cloudcoffee.auth_service.dto.CambiarAsignacionRequest;
import cl.cloudcoffee.auth_service.dto.CrearPersonalRequest;
import cl.cloudcoffee.auth_service.dto.EditarUsuarioRequest;
import cl.cloudcoffee.auth_service.dto.PaginaUsuariosResponse;
import cl.cloudcoffee.auth_service.dto.UsuarioAdminResponse;
import cl.cloudcoffee.auth_service.service.AdministracionUsuariosService;
import cl.cloudcoffee.errors.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;

/**
 * Administración de cuentas (INT2-121, contrato INT2-109). Gateway publica estas rutas bajo
 * {@code /v1/auth/admin}. SUPER_ADMIN administra todas las cuentas (INT2-121); ADMIN_CAFETERIA, solo los CAJERO
 * de la cafetería que Auth le tiene asignada (INT2-122). Una cuenta fuera de su alcance responde 404.
 * Todas las respuestas llevan {@code Cache-Control: no-store}.
 */
@Tag(name = "Administración de cuentas", description = "SUPER_ADMIN (global) y ADMIN_CAFETERIA (solo CAJERO de su cafetería asignada): personal por invitación, asignaciones y estado de las cuentas")
@SecurityRequirement(name = "bearerAuth")
@RestController
@RequestMapping("/auth/admin")
public class AdminUsuariosController {

    static final String IDEMPOTENCY_KEY = "Idempotency-Key";
    static final String IDEMPOTENCY_REPLAYED = "Idempotency-Replayed";

    private final AdministracionUsuariosService administracion;

    public AdminUsuariosController(AdministracionUsuariosService administracion) {
        this.administracion = administracion;
    }

    @Operation(operationId = "listarUsuarios", summary = "Listar cuentas",
            description = "Excluye las cuentas dadas de baja. Orden: email ASC, id ASC. q busca en email, nombre o apellido. "
                    + "ADMIN_CAFETERIA ve solo los CAJERO de su cafetería; otra cafetería en cafeteriaId: 403 ASIGNACION_NO_AUTORIZADA.")
    @GetMapping("/usuarios")
    public ResponseEntity<PaginaUsuariosResponse> listar(
            @RequestParam(required = false) String rol, @RequestParam(required = false) String estado,
            @RequestParam(required = false) String cafeteriaId, @RequestParam(required = false) String q,
            @RequestParam(required = false) String page, @RequestParam(required = false) String size,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        return privada(HttpStatus.OK).body(administracion.listar(jwt, rol, estado, cafeteriaId, q, page, size));
    }

    @Operation(operationId = "verUsuario", summary = "Ver cuenta")
    @GetMapping("/usuarios/{usuarioId}")
    public ResponseEntity<UsuarioAdminResponse> ver(@PathVariable UUID usuarioId,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        return privada(HttpStatus.OK).body(administracion.ver(jwt, usuarioId));
    }

    @Operation(operationId = "crearPersonal", summary = "Invitar personal",
            description = "Crea la cuenta pendiente de activación, sin contraseña utilizable, y envía la invitación por correo. "
                    + "ADMIN_CAFETERIA solo invita CAJERO (otro rol: 403 ROL_NO_PERMITIDO) a su cafetería: la omite o envía "
                    + "la suya (otra: 403 ASIGNACION_NO_AUTORIZADA). "
                    + "Valida la cafetería con Catalog: inexistente 404, dada de baja 409 CAFETERIA_DADA_DE_BAJA, "
                    + "Catalog caído 503 OPERACION_PENDIENTE. Email existente: 409 EMAIL_YA_REGISTRADO.")
    @PostMapping("/personal")
    public ResponseEntity<UsuarioAdminResponse> crearPersonal(
            @RequestHeader(IDEMPOTENCY_KEY) String clave, @Valid @RequestBody CrearPersonalRequest solicitud,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        var alta = administracion.crearPersonal(jwt, claveUuid(clave), solicitud);
        return privada(HttpStatus.CREATED)
                .location(URI.create("/v1/auth/admin/usuarios/" + alta.usuario().usuarioId()))
                .header(IDEMPOTENCY_REPLAYED, String.valueOf(alta.replay()))
                .body(alta.usuario());
    }

    @Operation(operationId = "invitacionUsuario", summary = "Reenviar invitación",
            description = "Solo cuentas pendientes de activación; revoca el token anterior.")
    @PostMapping("/usuarios/{usuarioId}/invitacion")
    public ResponseEntity<Void> reenviarInvitacion(@PathVariable UUID usuarioId,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        administracion.reenviarInvitacion(jwt, usuarioId);
        return privada(HttpStatus.ACCEPTED).build();
    }

    @Operation(operationId = "editarUsuario", summary = "Editar datos de contacto",
            description = "Exige la última version leída: si no coincide, 409 VERSION_CONFLICTO. El email y el rol no se editan.")
    @PatchMapping("/usuarios/{usuarioId}")
    public ResponseEntity<UsuarioAdminResponse> editar(@PathVariable UUID usuarioId,
            @Valid @RequestBody EditarUsuarioRequest cambios,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        return privada(HttpStatus.OK).body(administracion.editar(jwt, usuarioId, cambios));
    }

    @Operation(operationId = "cambiarAsignacion", summary = "Reasignar cafetería",
            description = "Solo SUPER_ADMIN y solo personal. Revoca los refresh tokens; rige en la siguiente solicitud.")
    @PutMapping("/usuarios/{usuarioId}/asignacion")
    public ResponseEntity<UsuarioAdminResponse> cambiarAsignacion(@PathVariable UUID usuarioId,
            @Valid @RequestBody CambiarAsignacionRequest cambio,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        return privada(HttpStatus.OK).body(administracion.cambiarAsignacion(jwt, usuarioId, cambio));
    }

    @Operation(operationId = "desactivarUsuario", summary = "Desactivar cuenta",
            description = "Reversible. Revoca refresh tokens; la asignación deja de autorizar de inmediato. "
                    + "No aplica a uno mismo ni al último SUPER_ADMIN activo.")
    @PostMapping("/usuarios/{usuarioId}/desactivar")
    public ResponseEntity<UsuarioAdminResponse> desactivar(@PathVariable UUID usuarioId,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        return privada(HttpStatus.OK).body(administracion.desactivar(jwt, usuarioId));
    }

    @Operation(operationId = "reactivarUsuario", summary = "Reactivar cuenta",
            description = "Repetir sobre una cuenta activa devuelve 200 sin cambios.")
    @PostMapping("/usuarios/{usuarioId}/reactivar")
    public ResponseEntity<UsuarioAdminResponse> reactivar(@PathVariable UUID usuarioId,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        return privada(HttpStatus.OK).body(administracion.reactivar(jwt, usuarioId));
    }

    @Operation(operationId = "bajaUsuario", summary = "Dar de baja (anonimizar)",
            description = "Irreversible: anonimiza la cuenta, revoca sus tokens y elimina su asignación. Conserva el id "
                    + "que referencian compras y auditoría. No aplica a uno mismo ni al último SUPER_ADMIN. Una cuenta CLIENTE "
                    + "con compras en curso responde 409 COMPRAS_EN_CURSO.")
    @PostMapping("/usuarios/{usuarioId}/baja")
    public ResponseEntity<UsuarioAdminResponse> baja(@PathVariable UUID usuarioId,
            @Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt) {
        return privada(HttpStatus.OK).body(administracion.darDeBaja(jwt, usuarioId));
    }

    private static ResponseEntity.BodyBuilder privada(HttpStatus status) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore());
    }

    private static UUID claveUuid(String clave) {
        try {
            UUID uuid = UUID.fromString(clave.strip());
            if (uuid.toString().equalsIgnoreCase(clave.strip())) return uuid;
        } catch (IllegalArgumentException ignored) {
            // Se responde 400 abajo.
        }
        throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/idempotency-key-invalida"),
                "Idempotency-Key inválida", "Idempotency-Key debe ser un UUID.", "IDEMPOTENCY_KEY_INVALIDA");
    }
}
