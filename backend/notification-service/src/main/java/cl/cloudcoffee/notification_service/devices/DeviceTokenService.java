package cl.cloudcoffee.notification_service.devices;

import cl.cloudcoffee.errors.BusinessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class DeviceTokenService {

    private static final Pattern APNS_TOKEN = Pattern.compile("[0-9a-fA-F]{64}");

    private final DeviceTokenRepository repository;
    private final TransactionTemplate transaction;

    public DeviceTokenService(DeviceTokenRepository repository, PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    public void registrar(UUID userId, DeviceTokenRequest request) {
        DevicePlatform platform = platform(request.plataforma());
        DeviceTokenType tokenType = tokenType(request, platform);
        validarTipoYToken(request.token(), platform, tokenType);
        String tokenHash = hash(request.token());

        try {
            transaction.executeWithoutResult(status ->
                    crearOActualizar(request.token(), tokenHash, userId, platform, tokenType));
        } catch (DataIntegrityViolationException duplicateRegistration) {
            // Una alta simultánea puede ganar la restricción única antes de esta transacción.
            transaction.executeWithoutResult(status -> {
                DeviceToken existing = repository.findByTokenHash(tokenHash)
                        .orElseThrow(() -> duplicateRegistration);
                existing.updateRegistration(request.token(), userId, platform, tokenType, Instant.now());
                repository.saveAndFlush(existing);
            });
        }
    }

    public void eliminar(UUID userId, DeviceTokenRequest request) {
        DevicePlatform platform = platform(request.plataforma());
        DeviceTokenType tokenType = tokenType(request, platform);
        validarTipoYToken(request.token(), platform, tokenType);
        String tokenHash = hash(request.token());
        transaction.executeWithoutResult(status ->
                repository.deleteByTokenHashAndUserIdAndPlatform(tokenHash, userId, platform));
    }

    private void crearOActualizar(String token, String tokenHash, UUID userId,
            DevicePlatform platform, DeviceTokenType tokenType) {
        Instant now = Instant.now();
        DeviceToken existing = repository.findByTokenHash(tokenHash).orElse(null);
        if (existing == null) {
            repository.saveAndFlush(new DeviceToken(token, tokenHash, userId, platform, tokenType, now));
            return;
        }
        existing.updateRegistration(token, userId, platform, tokenType, now);
        repository.saveAndFlush(existing);
    }

    private static DevicePlatform platform(String value) {
        return switch (value) {
            case "android" -> DevicePlatform.ANDROID;
            case "ios" -> DevicePlatform.IOS;
            default -> throw invalidRequest("La plataforma debe ser android o ios.");
        };
    }

    private static DeviceTokenType tokenType(DeviceTokenRequest request, DevicePlatform platform) {
        if (request.tipoToken() == null) {
            return platform == DevicePlatform.ANDROID ? DeviceTokenType.FCM : DeviceTokenType.APNS;
        }
        return DeviceTokenType.valueOf(request.tipoToken().toUpperCase(Locale.ROOT));
    }

    private static void validarTipoYToken(String token, DevicePlatform platform, DeviceTokenType tokenType) {
        if (platform == DevicePlatform.ANDROID && tokenType != DeviceTokenType.FCM) {
            throw invalidRequest("Android debe registrarse con un token FCM.");
        }
        if (tokenType == DeviceTokenType.APNS
                && (platform != DevicePlatform.IOS || !APNS_TOKEN.matcher(token).matches())) {
            throw invalidRequest("APNS requiere plataforma ios y un token hexadecimal de 64 caracteres.");
        }
    }

    private static BusinessException invalidRequest(String detail) {
        return new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/token-dispositivo-invalido"),
                "Token de dispositivo inválido", detail, "TOKEN_DISPOSITIVO_INVALIDO");
    }

    private static String hash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required to identify device tokens.", exception);
        }
    }
}
