package cl.cloudcoffee.auth_service.controller;

import java.util.UUID;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

import cl.cloudcoffee.auth_service.dto.LoginRequest;
import cl.cloudcoffee.auth_service.dto.LoginResponse;
import cl.cloudcoffee.auth_service.dto.PasswordRecoveryRequest;
import cl.cloudcoffee.auth_service.dto.PasswordResetRequest;
import cl.cloudcoffee.auth_service.dto.ReenviarVerificacionRequest;
import cl.cloudcoffee.auth_service.dto.RefreshTokenRequest;
import cl.cloudcoffee.auth_service.dto.RegistroClienteRequest;
import cl.cloudcoffee.auth_service.dto.RegistroClienteResponse;
import cl.cloudcoffee.auth_service.dto.VerificacionCorreoResponse;
import cl.cloudcoffee.auth_service.dto.VerificarCorreoRequest;
import cl.cloudcoffee.auth_service.service.LoginService;
import cl.cloudcoffee.auth_service.service.LogoutService;
import cl.cloudcoffee.auth_service.service.PasswordRecoveryService;
import cl.cloudcoffee.auth_service.service.RefreshTokenService;
import cl.cloudcoffee.auth_service.service.RegistroService;
import cl.cloudcoffee.auth_service.service.VerificacionService;

@Tag(name = "Autenticación", description = "Registro, verificación de correo y sesiones por dispositivo")
@RestController
@RequestMapping("/auth")
public class AuthController {

    private final RegistroService registroService;
    private final VerificacionService verificacionService;
    private final LoginService loginService;
    private final RefreshTokenService refreshTokenService;
    private final PasswordRecoveryService passwordRecoveryService;
    private final LogoutService logoutService;

    public AuthController(RegistroService registroService, VerificacionService verificacionService,
            LoginService loginService, RefreshTokenService refreshTokenService,
            PasswordRecoveryService passwordRecoveryService, LogoutService logoutService) {
        this.registroService = registroService;
        this.verificacionService = verificacionService;
        this.loginService = loginService;
        this.refreshTokenService = refreshTokenService;
        this.passwordRecoveryService = passwordRecoveryService;
        this.logoutService = logoutService;
    }

    @Operation(operationId = "iniciarSesion", summary = "Iniciar sesión", description = "Devuelve un access token JWT RS256 y un refresh token opaco por dispositivo. Requiere una cuenta con correo verificado.")
    @ApiResponse(responseCode = "200", description = "Sesión iniciada", content = @Content(mediaType = "application/json", schema = @Schema(implementation = LoginResponse.class)))
    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        return loginService.iniciarSesion(request.email(), request.password());
    }

    @Operation(operationId = "renovarSesion", summary = "Renovar sesión", description = "Rota el refresh token: el presentado queda revocado y debe reemplazarse por el nuevo par de tokens. No requiere un access token vigente.")
    @ApiResponse(responseCode = "200", description = "Nuevo par de tokens", content = @Content(mediaType = "application/json", schema = @Schema(implementation = LoginResponse.class)))
    @PostMapping("/refresh")
    public LoginResponse refresh(@Valid @RequestBody RefreshTokenRequest request) {
        return refreshTokenService.renovar(request.refreshToken());
    }

    @Operation(operationId = "cerrarSesion", summary = "Cerrar sesión del dispositivo", description = "Revoca el refresh token del usuario autenticado. Repetir la operación con el mismo token revocado es válido. El access token permanece vigente hasta expirar y otras sesiones no se modifican.")
    @SecurityRequirement(name = "bearerAuth")
    @ApiResponse(responseCode = "204", description = "Sesión cerrada, sin cuerpo", content = @Content)
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@Parameter(hidden = true) @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RefreshTokenRequest request) {
        logoutService.cerrarSesion(jwt.getSubject(), request.refreshToken());
    }

    @Operation(operationId = "registrarCliente", summary = "Registrar cliente", description = "Crea una cuenta CLIENTE sin verificar y solicita el envío del correo de verificación.")
    @ApiResponse(responseCode = "201", description = "Cliente registrado", content = @Content(mediaType = "application/json", schema = @Schema(implementation = RegistroClienteResponse.class)))
    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public RegistroClienteResponse register(@Valid @RequestBody RegistroClienteRequest request,
            @Parameter(description = "Identificador opcional de correlación del evento; se genera si falta o está vacío", example = "demo-registro-001")
            @RequestHeader(value = "X-Trace-Id", required = false) String traceId) {
        return registroService.registrarCliente(request, traceIdEfectivo(traceId));
    }

    @Operation(operationId = "verificarCorreo", summary = "Verificar correo", description = "Consume un token de verificación vigente. El token caduca después de 24 horas y no puede reutilizarse.")
    @ApiResponse(responseCode = "200", description = "Correo verificado", content = @Content(mediaType = "application/json", schema = @Schema(implementation = VerificacionCorreoResponse.class)))
    @PostMapping("/verificacion")
    public VerificacionCorreoResponse verificar(@Valid @RequestBody VerificarCorreoRequest request) {
        return verificacionService.verificarCorreo(request.token());
    }

    @Operation(operationId = "reenviarVerificacion", summary = "Reenviar verificación", description = "Revoca las verificaciones anteriores y solicita un nuevo correo para una cuenta existente que aún no está verificada.")
    @ApiResponse(responseCode = "202", description = "Solicitud aceptada, sin cuerpo", content = @Content)
    @PostMapping("/verificacion/reenviar")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void reenviarVerificacion(@Valid @RequestBody ReenviarVerificacionRequest request,
            @Parameter(description = "Identificador opcional de correlación del evento; se genera si falta o está vacío", example = "demo-registro-001")
            @RequestHeader(value = "X-Trace-Id", required = false) String traceId) {
        verificacionService.reenviarVerificacion(request.email(), traceIdEfectivo(traceId));
    }

    @Operation(operationId = "solicitarRecuperacion", summary = "Solicitar recuperación de contraseña", description = "Acepta la solicitud sin revelar si el correo existe. El envío se procesa mediante eventos.")
    @ApiResponse(responseCode = "202", description = "Solicitud aceptada, sin cuerpo", content = @Content)
    @PostMapping("/password/recovery")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void recovery(@Valid @RequestBody PasswordRecoveryRequest request,
            @Parameter(description = "Identificador opcional de correlación del evento; se genera si falta o está vacío", example = "demo-registro-001")
            @RequestHeader(value = "X-Trace-Id", required = false) String traceId) {
        passwordRecoveryService.solicitar(request.email(), traceIdEfectivo(traceId));
    }

    @Operation(operationId = "restablecerPassword", summary = "Restablecer contraseña", description = "Consume un token de recuperación vigente y revoca los refresh tokens del usuario. Los JWT ya emitidos permanecen vigentes hasta expirar.")
    @ApiResponse(responseCode = "204", description = "Contraseña restablecida, sin cuerpo", content = @Content)
    @PostMapping("/password/reset")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reset(@Valid @RequestBody PasswordResetRequest request) {
        passwordRecoveryService.restablecer(request.token(), request.nuevaPassword());
    }

    private static String traceIdEfectivo(String traceId) {
        return traceId == null || traceId.isBlank() ? UUID.randomUUID().toString() : traceId;
    }
}
