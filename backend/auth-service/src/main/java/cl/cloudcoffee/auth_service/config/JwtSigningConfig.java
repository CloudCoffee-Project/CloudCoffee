package cl.cloudcoffee.auth_service.config;

import java.io.IOException;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.security.converter.RsaKeyConverters;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

@Configuration(proxyBeanMethods = false)
public class JwtSigningConfig {

    @Bean
    JwtEncoder jwtEncoder(RSAPublicKey jwtPublicKey,
            @Value("${cloudcoffee.jwt.private-key-location:${JWT_PRIVATE_KEY_LOCATION}}") Resource location)
            throws IOException {
        try (var input = location.getInputStream()) {
            RSAPrivateKey privateKey = RsaKeyConverters.pkcs8().convert(input);
            if (privateKey == null || !jwtPublicKey.getModulus().equals(privateKey.getModulus())) {
                throw new IllegalArgumentException("JWT private and public keys must belong to the same RSA pair");
            }
            RSAKey key = new RSAKey.Builder(jwtPublicKey).privateKey(privateKey).build();
            return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(key)));
        }
    }
}
