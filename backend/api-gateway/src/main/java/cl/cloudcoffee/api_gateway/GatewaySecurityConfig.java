package cl.cloudcoffee.api_gateway;

import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.access.AccessDeniedHandlerImpl;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;

@Configuration(proxyBeanMethods = false)
public class GatewaySecurityConfig {

    @Bean
    SecurityFilterChain gatewaySecurityFilterChain(HttpSecurity http,
            ObjectProvider<AuthenticationEntryPoint> entryPoints,
            ObjectProvider<AccessDeniedHandler> accessDeniedHandlers) throws Exception {
        return http
                // API sin autenticacion por cookies ni sesiones de navegador.
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(exceptions -> exceptions
                        // Usar adaptadores comunes si existen, sin depender del modulo de INT2-12.
                        .authenticationEntryPoint(entryPoints.getIfAvailable(
                                () -> new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                        .accessDeniedHandler(accessDeniedHandlers.getIfAvailable(AccessDeniedHandlerImpl::new)))
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        // Contratos de Auth: INT2-19, 20, 21, 22 y 26.
                        .requestMatchers(HttpMethod.POST,
                                "/v1/auth/register",
                                "/v1/auth/login",
                                "/v1/auth/refresh",
                                "/v1/auth/verificacion",
                                "/v1/auth/verificacion/reenviar",
                                "/v1/auth/password/recovery",
                                "/v1/auth/password/reset").permitAll()
                        // Consultas publicas definidas en INT2-33.
                        .requestMatchers(HttpMethod.GET,
                                "/v1/catalog/campus", "/v1/catalog/categorias").permitAll()
                        .requestMatchers(HttpMethod.HEAD,
                                "/v1/catalog/campus", "/v1/catalog/categorias").permitAll()
                        // INT2-14 conectara aqui la validacion JWT. Un header Bearer
                        // por si solo no autentica: estas rutas quedan cerradas mientras tanto.
                        .requestMatchers("/v1/**").authenticated()
                        // No hay rutas de proxy fuera de /v1; conservar sus errores 404.
                        .anyRequest().permitAll())
                .build();
    }
}
