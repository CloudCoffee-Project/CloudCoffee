package cl.cloudcoffee.security.testing;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Llaves efimeras: nunca se incluyen credenciales de prueba en los JAR de produccion. */
public abstract class JwtTestSupport {
    public static final KeyPair KEYS = newKeyPair();
    public static final String SUBJECT = UUID.randomUUID().toString();
    public static final String PUBLIC_KEY_LOCATION = pem("PUBLIC KEY", KEYS.getPublic().getEncoded());
    public static final String PRIVATE_KEY_LOCATION = pem("PRIVATE KEY", KEYS.getPrivate().getEncoded());

    @DynamicPropertySource
    static void publicKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PUBLIC_KEY_LOCATION", () -> PUBLIC_KEY_LOCATION);
    }

    public static KeyPair newKeyPair() {
        try {
            var generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    public static String pem(String label, byte[] bytes) {
        try {
            Path path = Files.createTempFile("cloudcoffee-jwt-test-", ".pem");
            path.toFile().deleteOnExit();
            Files.writeString(path, "-----BEGIN " + label + "-----\n"
                    + Base64.getMimeEncoder(64, new byte[]{'\n'}).encodeToString(bytes)
                    + "\n-----END " + label + "-----\n");
            return path.toUri().toString();
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    public static JWTClaimsSet.Builder claims() {
        return new JWTClaimsSet.Builder().subject(SUBJECT).claim("role", "CLIENTE")
                .issueTime(Date.from(Instant.now()))
                .expirationTime(Date.from(Instant.now().plusSeconds(300)));
    }

    public static String token() {
        return sign(claims().build(), KEYS, JWSAlgorithm.RS256);
    }

    public static String sign(JWTClaimsSet claims, KeyPair keys, JWSAlgorithm algorithm) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader(algorithm), claims);
            jwt.sign(new RSASSASigner((RSAPrivateKey) keys.getPrivate()));
            return jwt.serialize();
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    public static String invalidToken(String kind) {
        return switch (kind) {
            case "malformed" -> "not-a-jwt";
            case "expired" -> sign(claims().expirationTime(Date.from(Instant.now().minusSeconds(2))).build(), KEYS, JWSAlgorithm.RS256);
            case "wrong-key" -> sign(claims().build(), newKeyPair(), JWSAlgorithm.RS256);
            case "wrong-algorithm" -> sign(claims().build(), KEYS, JWSAlgorithm.RS512);
            case "missing-exp" -> sign(claims().expirationTime(null).build(), KEYS, JWSAlgorithm.RS256);
            case "missing-sub" -> sign(claims().subject(null).build(), KEYS, JWSAlgorithm.RS256);
            case "missing-role" -> sign(claims().claim("role", null).build(), KEYS, JWSAlgorithm.RS256);
            case "invalid-role" -> sign(claims().claim("role", "ROOT").build(), KEYS, JWSAlgorithm.RS256);
            case "future" -> sign(claims().notBeforeTime(Date.from(Instant.now().plusSeconds(60))).build(), KEYS, JWSAlgorithm.RS256);
            case "tampered" -> {
                String[] parts = token().split("\\.");
                String payload = new String(Base64.getUrlDecoder().decode(parts[1]), java.nio.charset.StandardCharsets.UTF_8);
                yield parts[0] + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(
                        payload.replace("CLIENTE", "SUPER_ADMIN").getBytes(java.nio.charset.StandardCharsets.UTF_8)) + "." + parts[2];
            }
            case "hmac" -> {
                try {
                    SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims().build());
                    jwt.sign(new MACSigner(KEYS.getPublic().getEncoded()));
                    yield jwt.serialize();
                } catch (Exception exception) {
                    throw new IllegalStateException(exception);
                }
            }
            default -> throw new IllegalArgumentException(kind);
        };
    }
}
