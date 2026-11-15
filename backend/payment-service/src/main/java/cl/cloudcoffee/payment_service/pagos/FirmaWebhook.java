package cl.cloudcoffee.payment_service.pagos;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Verificación del origen de una notificación de Mercado Pago (documentación oficial de Webhooks, "validar
 * origen de una notificación").
 *
 * <p>{@code x-signature} tiene la forma {@code ts=<timestamp>,v1=<hmac>}. El HMAC-SHA256 en hexadecimal,
 * calculado con la clave secreta de la aplicación, cubre el manifiesto
 * {@code id:<data.id>;request-id:<x-request-id>;ts:<ts>;}, donde {@code data.id} es el parámetro de la URL
 * (en minúsculas si es alfanumérico). La documentación permite omitir partes ausentes del manifiesto; aquí se
 * exigen las tres, porque una notificación de pago siempre las trae y aceptar menos debilitaría la firma.
 *
 * <p>La comparación es en tiempo constante y el timestamp debe estar dentro de la tolerancia configurada,
 * en ambos sentidos. Ningún valor de la firma ni del secreto se incluye en los motivos de rechazo.
 */
public final class FirmaWebhook {

    private static final Pattern HEX_64 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern DIGITOS = Pattern.compile("[0-9]{1,15}");
    /** Valores inferiores son segundos; desde aquí, milisegundos (se aceptan ambos formatos observados). */
    private static final long UMBRAL_MILISEGUNDOS = 100_000_000_000L;

    private FirmaWebhook() {
    }

    public sealed interface Resultado permits Valida, Invalida {
    }

    public record Valida() implements Resultado {
    }

    public record Invalida(String motivo) implements Resultado {
    }

    public static Resultado verificar(String secreto, String firma, String requestId, String dataId, Instant ahora,
            Duration tolerancia) {
        if (secreto == null || secreto.isBlank()) return new Invalida("sin secreto configurado");
        if (firma == null || firma.isBlank() || firma.length() > 512) return new Invalida("x-signature ausente");
        if (requestId == null || requestId.isBlank() || requestId.length() > 128) return new Invalida("x-request-id ausente");
        if (dataId == null || dataId.isBlank()) return new Invalida("data.id ausente");
        String ts = null;
        String v1 = null;
        for (String parte : firma.split(",")) {
            int igual = parte.indexOf('=');
            if (igual < 0) continue;
            String clave = parte.substring(0, igual).trim();
            String valor = parte.substring(igual + 1).trim();
            if ("ts".equals(clave)) {
                if (ts != null) return new Invalida("ts repetido");
                ts = valor;
            } else if ("v1".equals(clave)) {
                if (v1 != null) return new Invalida("v1 repetido");
                v1 = valor.toLowerCase(Locale.ROOT);
            }
        }
        if (ts == null || !DIGITOS.matcher(ts).matches()) return new Invalida("ts inválido");
        if (v1 == null || !HEX_64.matcher(v1).matches()) return new Invalida("v1 inválido");
        long numero = Long.parseLong(ts);
        Instant emitida = numero >= UMBRAL_MILISEGUNDOS ? Instant.ofEpochMilli(numero) : Instant.ofEpochSecond(numero);
        if (Duration.between(emitida, ahora).abs().compareTo(tolerancia) > 0) return new Invalida("fuera de tolerancia");
        byte[] esperada = hmac(secreto, manifiesto(dataId, requestId, ts)).getBytes(StandardCharsets.US_ASCII);
        byte[] recibida = v1.getBytes(StandardCharsets.US_ASCII);
        return MessageDigest.isEqual(esperada, recibida) ? new Valida() : new Invalida("hmac no coincide");
    }

    /** HMAC-SHA256 en hexadecimal minúscula. Público para generar firmas en pruebas y en el simulador local. */
    public static String hmac(String secreto, String manifiesto) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(manifiesto.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException | InvalidKeyException error) {
            throw new IllegalStateException("HmacSHA256 no disponible", error);
        }
    }

    /** Manifiesto oficial; expuesto para que las pruebas firmen exactamente como el proveedor. */
    public static String manifiesto(String dataId, String requestId, String ts) {
        return "id:" + dataId.toLowerCase(Locale.ROOT) + ";request-id:" + requestId + ";ts:" + ts + ";";
    }
}
