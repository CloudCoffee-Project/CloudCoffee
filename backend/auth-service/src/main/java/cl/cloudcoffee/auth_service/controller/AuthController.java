package cl.cloudcoffee.auth_service.controller;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.Valid;

import cl.cloudcoffee.auth_service.dto.LoginRequest;
import cl.cloudcoffee.auth_service.dto.LoginResponse;
import cl.cloudcoffee.auth_service.dto.ReenviarVerificacionRequest;
import cl.cloudcoffee.auth_service.dto.RefreshTokenRequest;
import cl.cloudcoffee.auth_service.dto.RegistroClienteRequest;
import cl.cloudcoffee.auth_service.dto.RegistroClienteResponse;
import cl.cloudcoffee.auth_service.dto.VerificacionCorreoResponse;
import cl.cloudcoffee.auth_service.dto.VerificarCorreoRequest;
import cl.cloudcoffee.auth_service.service.LoginService;
import cl.cloudcoffee.auth_service.service.RefreshTokenService;
import cl.cloudcoffee.auth_service.service.RegistroService;
import cl.cloudcoffee.auth_service.service.VerificacionService;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final RegistroService registroService;
    private final VerificacionService verificacionService;
    private final LoginService loginService;
    private final RefreshTokenService refreshTokenService;

    public AuthController(RegistroService registroService, VerificacionService verificacionService,
            LoginService loginService, RefreshTokenService refreshTokenService) {
        this.registroService = registroService;
        this.verificacionService = verificacionService;
        this.loginService = loginService;
        this.refreshTokenService = refreshTokenService;
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest request) {
        return loginService.iniciarSesion(request.email(), request.password());
    }

    @PostMapping("/refresh")
    public LoginResponse refresh(@Valid @RequestBody RefreshTokenRequest request) {
        return refreshTokenService.renovar(request.refreshToken());
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public RegistroClienteResponse register(@Valid @RequestBody RegistroClienteRequest request,
            @RequestHeader(value = "X-Trace-Id", required = false) String traceId) {
        return registroService.registrarCliente(request, traceIdEfectivo(traceId));
    }

    @PostMapping("/verificacion")
    public VerificacionCorreoResponse verificar(@Valid @RequestBody VerificarCorreoRequest request) {
        return verificacionService.verificarCorreo(request.token());
    }

    @PostMapping("/verificacion/reenviar")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void reenviarVerificacion(@Valid @RequestBody ReenviarVerificacionRequest request,
            @RequestHeader(value = "X-Trace-Id", required = false) String traceId) {
        verificacionService.reenviarVerificacion(request.email(), traceIdEfectivo(traceId));
    }

    private static String traceIdEfectivo(String traceId) {
        return traceId == null || traceId.isBlank() ? UUID.randomUUID().toString() : traceId;
    }
}
