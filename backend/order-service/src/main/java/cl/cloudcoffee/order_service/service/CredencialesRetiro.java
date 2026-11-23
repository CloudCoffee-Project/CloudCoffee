package cl.cloudcoffee.order_service.service;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** El hash permite validar el código y AES-GCM permite recuperarlo después de reiniciar. */
@Component
public class CredencialesRetiro {
    private final SecureRandom random = new SecureRandom();
    private final String encryptionKey;

    public CredencialesRetiro(@Value("${cloudcoffee.retiro.encryption-key:}") String encryptionKey) {
        this.encryptionKey = encryptionKey;
    }

    public record Credencial(String hash, String cifrado) {}

    public Credencial emitir(UUID ordenId) {
        try {
            byte[] codigo = new byte[32];
            byte[] iv = new byte[12];
            random.nextBytes(codigo);
            random.nextBytes(iv);
            Cipher cipher = cipher(Cipher.ENCRYPT_MODE, ordenId, iv);
            byte[] encrypted = cipher.doFinal(codigo);
            String cifrado = Base64.getEncoder().encodeToString(
                    ByteBuffer.allocate(iv.length + encrypted.length).put(iv).put(encrypted).array());
            String token = Base64.getUrlEncoder().withoutPadding().encodeToString(codigo);
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.US_ASCII)));
            return new Credencial(hash, cifrado);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw noDisponible();
        }
    }

    public String recuperar(UUID ordenId, String cifrado) {
        try {
            byte[] stored = Base64.getDecoder().decode(cifrado);
            if (stored.length != 60) throw new IllegalArgumentException();
            byte[] iv = new byte[12];
            ByteBuffer.wrap(stored).get(iv);
            byte[] codigo = cipher(Cipher.DECRYPT_MODE, ordenId, iv).doFinal(stored, iv.length, stored.length - iv.length);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(codigo);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw noDisponible();
        }
    }

    private Cipher cipher(int mode, UUID ordenId, byte[] iv) throws GeneralSecurityException {
        byte[] key = Base64.getDecoder().decode(encryptionKey);
        if (key.length != 32) throw new IllegalArgumentException();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD(ordenId.toString().getBytes(StandardCharsets.US_ASCII));
        return cipher;
    }

    private static ResponseStatusException noDisponible() {
        // No incorporar claves, códigos, ciphertext ni causas criptográficas al error.
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "La credencial de retiro no está disponible.");
    }
}
