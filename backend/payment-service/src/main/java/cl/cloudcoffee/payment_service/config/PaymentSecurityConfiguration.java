package cl.cloudcoffee.payment_service.config;

import cl.cloudcoffee.errors.security.ApiSecurityErrorHandler;
import cl.cloudcoffee.security.InternalServiceAuthenticationFilter;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration(proxyBeanMethods = false)
public class PaymentSecurityConfiguration {
    @Bean
    SecurityFilterChain paymentSecurityFilterChain(HttpSecurity http, ApiSecurityErrorHandler errors,
            JwtAuthenticationConverter converter,
            @Value("${cloudcoffee.internal.token:${INTERNAL_SERVICE_TOKEN:}}") String internalToken) throws Exception {
        return http
                .addFilterBefore(new InternalServiceAuthenticationFilter(internalToken),
                        BearerTokenAuthenticationFilter.class)
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(ex -> ex.authenticationEntryPoint(errors).accessDeniedHandler(errors))
                .oauth2ResourceServer(resource -> resource
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(converter))
                        .authenticationEntryPoint(errors).accessDeniedHandler(errors))
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/info").permitAll()
                        .requestMatchers(HttpMethod.HEAD, "/actuator/health", "/actuator/info").permitAll()
                        // INT2-112: authenticated by the provider's HMAC signature (RecepcionWebhook), never a user JWT.
                        // Only this exact POST is public; any other webhook path or method still requires auth.
                        .requestMatchers(HttpMethod.POST, "/payments/webhooks/mercadopago").permitAll()
                        .requestMatchers(InternalServiceAuthenticationFilter.PATH_PREFIX + "**")
                            .hasRole(InternalServiceAuthenticationFilter.ROLE)
                        .anyRequest().authenticated())
                .build();
    }
}
