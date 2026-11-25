package cl.cloudcoffee.auth_service.dto;

import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(name = "ActivacionResultado")
public record ActivacionResponse(UUID usuarioId, String email, String rol) {
}
