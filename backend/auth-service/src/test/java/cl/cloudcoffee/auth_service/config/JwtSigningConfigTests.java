package cl.cloudcoffee.auth_service.config;

import java.security.interfaces.RSAPublicKey;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

class JwtSigningConfigTests extends JwtTestSupport {
    @Test
    void rejectsMismatchedPrivateKey() {
        var other = newKeyPair();
        var resource = new DefaultResourceLoader().getResource(pem("PRIVATE KEY", other.getPrivate().getEncoded()));
        assertThatIllegalArgumentException().isThrownBy(() -> new JwtSigningConfig().jwtEncoder(
                (RSAPublicKey) KEYS.getPublic(), resource));
    }
}
