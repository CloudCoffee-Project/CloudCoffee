package cl.cloudcoffee.auth_service.openapi;

import java.util.List;
import java.util.Map;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.headers.Header;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "cloudcoffee.openapi.enabled", havingValue = "true")
public class AuthOpenApiConfiguration {

    @Bean
    OpenAPI authOpenApi() {
        return new OpenAPI()
                .info(new Info().title("CloudCoffee · Auth").version("v1")
                        .description("API Sprint 1. Ejemplos ficticios. Consultar y ejecutar a través del API Gateway."))
                .servers(List.of(new Server().url("/v1").description("API Gateway del mismo origen")))
                .components(new Components()
                        .addSecuritySchemes("bearerAuth", new SecurityScheme().type(SecurityScheme.Type.HTTP)
                                .scheme("bearer").bearerFormat("JWT")
                                .description("JWT RS256 obtenido mediante login; pegar solo el accessToken en Authorize.")));
    }

    @Bean
    OpenApiCustomizer authErrors() {
        return api -> {
            api.getComponents().addSchemas("Problem", problemSchema());
            api.getPaths().forEach((path, item) -> item.readOperationsMap().forEach((method, operation) -> {
                if (!method.name().equals("GET")) {
                    operation.getResponses().addApiResponse("400", problem("Solicitud o token inválido", 400, path));
                    operation.getResponses().addApiResponse("415", problem("Se requiere Content-Type: application/json", 415, path));
                }
                operation.getResponses().addApiResponse("401", problem(
                        "JWT inválido; en rutas protegidas también JWT ausente. Login: credenciales incorrectas. Refresh/logout: refresh token inválido. Cambio de contraseña: contraseña actual incorrecta.", 401, path));
                operation.getResponses().addApiResponse("500", problem("Error interno; no expone detalles sensibles", 500, path));
                if (path.equals("/auth/login")) {
                    operation.getResponses().addApiResponse("403", problem("Cuenta sin correo verificado", 403, path));
                }
                if (path.equals("/auth/register") || path.equals("/auth/verificacion/reenviar")) {
                    operation.getResponses().addApiResponse("409", problem(
                            path.endsWith("register") ? "Correo ya registrado" : "Correo ya verificado", 409, path));
                }
                if (path.equals("/auth/verificacion/reenviar")) {
                    operation.getResponses().addApiResponse("404", problem("No existe una cuenta para el correo", 404, path));
                }
                if (path.startsWith("/auth/users/me")) {
                    operation.getResponses().addApiResponse("404", problem("No existe la cuenta del sujeto del JWT", 404, path));
                }
                if (List.of("/auth/login", "/auth/password/recovery", "/auth/verificacion/reenviar").contains(path)) {
                    operation.getResponses().addApiResponse("429", problem("Cuota por IP agotada en API Gateway; no llega a Auth", 429, path)
                            .addHeaderObject("Retry-After", new Header().description("Segundos hasta la recarga de la cuota")
                                    .schema(new IntegerSchema().minimum(java.math.BigDecimal.ONE)).example(60)));
                }
            }));
        };
    }

    private static ObjectSchema problemSchema() {
        var error = new ObjectSchema().addProperty("field", new StringSchema().example("email"))
                .addProperty("message", new StringSchema().example("El correo debe ser válido."));
        var schema = new ObjectSchema();
        schema.addProperty("type", new StringSchema().format("uri-reference").example("about:blank"));
        schema.addProperty("title", new StringSchema().example("Bad Request"));
        schema.addProperty("status", new IntegerSchema().format("int32").example(400));
        schema.addProperty("detail", new StringSchema().example("La solicitud contiene datos inválidos."));
        schema.addProperty("instance", new StringSchema().format("uri-reference").example("/auth/register")
                .description("Ruta del proceso que produjo el error; los errores reenviados por Auth usan su ruta interna."));
        schema.addProperty("timestamp", new StringSchema().format("date-time").example("2026-09-30T12:00:00Z"));
        schema.addProperty("errors", new ArraySchema().items(error).description("Solo presente en errores de validación de campos"));
        schema.setRequired(List.of("type", "title", "status", "detail", "instance", "timestamp"));
        schema.setDescription("Contrato RFC 9457; no incluye contraseñas, tokens ni valores rechazados.");
        return schema;
    }

    private static ApiResponse problem(String description, int status, String path) {
        return new ApiResponse().description(description).content(new Content().addMediaType("application/problem+json",
                new io.swagger.v3.oas.models.media.MediaType().schema(new ObjectSchema().$ref("#/components/schemas/Problem"))
                        .example(Map.of("type", "about:blank", "title", "Error HTTP", "status", status,
                                "detail", description, "instance", status == 429 ? "/v1" + path : path,
                                "timestamp", "2026-09-30T12:00:00Z"))));
    }
}
