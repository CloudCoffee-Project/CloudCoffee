package cl.cloudcoffee.api_gateway.openapi;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.web.servlet.function.RequestPredicate;
import org.springframework.web.servlet.function.RequestPredicates;
import org.springframework.web.servlet.function.RouterFunction;
import org.springframework.web.servlet.function.ServerResponse;

import static org.springframework.cloud.gateway.server.mvc.filter.BeforeFilterFunctions.setPath;
import static org.springframework.cloud.gateway.server.mvc.filter.BeforeFilterFunctions.uri;
import static org.springframework.cloud.gateway.server.mvc.handler.GatewayRouterFunctions.route;
import static org.springframework.cloud.gateway.server.mvc.handler.HandlerFunctions.http;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "cloudcoffee.openapi.enabled", havingValue = "true")
public class GatewayOpenApiConfiguration {

    @Bean
    RouterFunction<ServerResponse> authOpenApiRoute(
            @Value("${AUTH_SERVICE_URL:http://localhost:18081}") String serviceUrl) {
        return route("openapi-auth").route(readContract("/openapi/auth"), http())
                .before(uri(serviceUrl)).before(setPath("/v3/api-docs")).build();
    }

    @Bean
    RouterFunction<ServerResponse> catalogOpenApiRoute(
            @Value("${CATALOG_SERVICE_URL:http://localhost:18082}") String serviceUrl) {
        return route("openapi-catalog").route(readContract("/openapi/catalog"), http())
                .before(uri(serviceUrl)).before(setPath("/v3/api-docs")).build();
    }

    private static RequestPredicate readContract(String path) {
        return RequestPredicates.methods(HttpMethod.GET, HttpMethod.HEAD).and(RequestPredicates.path(path));
    }
}
