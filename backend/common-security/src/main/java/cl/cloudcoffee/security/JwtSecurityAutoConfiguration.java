package cl.cloudcoffee.security;

import java.io.IOException;
import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.util.Set;

import cl.cloudcoffee.errors.security.ApiSecurityErrorHandler;
import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

@AutoConfiguration(beforeName = {
        "org.springframework.boot.security.autoconfigure.web.servlet.ServletWebSecurityAutoConfiguration",
        "org.springframework.boot.security.oauth2.server.resource.autoconfigure.servlet.OAuth2ResourceServerAutoConfiguration"})
public class JwtSecurityAutoConfiguration {

    private static final Set<String> ROLES = Set.of("CLIENTE", "CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN");

    @Bean
    RSAPublicKey jwtPublicKey(
            @Value("${cloudcoffee.jwt.public-key-location:${JWT_PUBLIC_KEY_LOCATION}}") Resource location)
            throws IOException {
        try (var input = location.getInputStream()) {
            RSAPublicKey key = RsaKeyConverters.x509().convert(input);
            if (key == null || key.getModulus().bitLength() < 2048) {
                throw new IllegalArgumentException("JWT requires an RSA public key of at least 2048 bits");
            }
            return key;
        }
    }

    @Bean
    JwtDecoder jwtDecoder(RSAPublicKey jwtPublicKey) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey(jwtPublicKey)
                .signatureAlgorithm(SignatureAlgorithm.RS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(Duration.ZERO), jwt -> {
                    Object role = jwt.getClaims().get("role");
                    if (jwt.getExpiresAt() == null || jwt.getSubject() == null || jwt.getSubject().isBlank()
                            || !(role instanceof String value) || !ROLES.contains(value)) {
                        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token",
                                "JWT requires sub, exp and a valid role", null));
                    }
                    return OAuth2TokenValidatorResult.success();
                }));
        return decoder;
    }

    @Bean
    JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName("role");
        authorities.setAuthorityPrefix("ROLE_");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }

    @Bean
    @ConditionalOnMissingBean(SecurityFilterChain.class)
    SecurityFilterChain serviceSecurityFilterChain(HttpSecurity http, ApiSecurityErrorHandler errors,
            JwtAuthenticationConverter converter) throws Exception {
        return http
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(exceptions -> exceptions.authenticationEntryPoint(errors).accessDeniedHandler(errors))
                .oauth2ResourceServer(resource -> resource
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(converter))
                        .authenticationEntryPoint(errors).accessDeniedHandler(errors))
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.POST, "/auth/register", "/auth/login", "/auth/refresh",
                                "/auth/verificacion", "/auth/verificacion/reenviar",
                                "/auth/password/recovery", "/auth/password/reset").permitAll()
                        .requestMatchers(HttpMethod.GET, "/catalog/campus", "/catalog/categorias").permitAll()
                        .requestMatchers(HttpMethod.HEAD, "/catalog/campus", "/catalog/categorias").permitAll()
                        // Conservar los endpoints de monitoreo ya expuestos por Notification.
                        .requestMatchers(HttpMethod.GET, "/actuator/health", "/actuator/info").permitAll()
                        .requestMatchers(HttpMethod.HEAD, "/actuator/health", "/actuator/info").permitAll()
                        .anyRequest().authenticated())
                .build();
    }
}
