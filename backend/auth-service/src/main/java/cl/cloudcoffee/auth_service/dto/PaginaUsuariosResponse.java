package cl.cloudcoffee.auth_service.dto;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;

/** Forma de paginación de INT2-50. */
@Schema(name = "PaginaUsuarios")
public record PaginaUsuariosResponse(List<UsuarioAdminResponse> content, int number, int size,
        long totalElements, int totalPages, boolean first, boolean last, boolean empty) {
}
