package cl.cloudcoffee.security;

import java.security.KeyPairGenerator;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.DefaultResourceLoader;

import static org.assertj.core.api.Assertions.*;

class JwtConfigurationTests {
    private final JwtSecurityAutoConfiguration config = new JwtSecurityAutoConfiguration();

    @Test
    void refusesMissingOrMalformedPublicKeys() {
        assertThatException().isThrownBy(() -> config.jwtPublicKey(
                new DefaultResourceLoader().getResource("file:/missing-cloudcoffee-key.pem")));
        assertThatException().isThrownBy(() -> config.jwtPublicKey(new ByteArrayResource("not-a-key".getBytes())));
    }

    @Test
    void refusesWeakRsaKeys() throws Exception {
        var generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(1024);
        var resource = new DefaultResourceLoader().getResource(
                JwtTestSupport.pem("PUBLIC KEY", generator.generateKeyPair().getPublic().getEncoded()));
        assertThatIllegalArgumentException().isThrownBy(() -> config.jwtPublicKey(resource));
    }
}
