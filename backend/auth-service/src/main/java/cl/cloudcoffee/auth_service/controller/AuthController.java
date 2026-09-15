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

import cl.cloudcoffee.auth_service.dto.RegistroClienteRequest;
import cl.cloudcoffee.auth_service.dto.RegistroClienteResponse;
import cl.cloudcoffee.auth_service.service.RegistroService;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final RegistroService registroService;

    public AuthController(RegistroService registroService) {
        this.registroService = registroService;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public RegistroClienteResponse register(@Valid @RequestBody RegistroClienteRequest request,
            @RequestHeader(value = "X-Trace-Id", required = false) String traceId) {
        String effectiveTraceId = traceId == null || traceId.isBlank()
                ? UUID.randomUUID().toString()
                : traceId;
        return registroService.registrarCliente(request, effectiveTraceId);
    }
}
