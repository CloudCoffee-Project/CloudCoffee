package cl.cloudcoffee.notification_service.devices;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record DeviceTokenRequest(
        @NotBlank(message = "El token es obligatorio.")
        @Size(max = 4096, message = "El token no puede superar 4096 caracteres.")
        @Pattern(regexp = "[^\\s\\p{Cntrl}]+", message = "El token no puede contener espacios ni caracteres de control.")
        String token,
        @NotBlank(message = "La plataforma es obligatoria.")
        @Pattern(regexp = "android|ios", message = "La plataforma debe ser android o ios.")
        String plataforma,
        @Pattern(regexp = "(?i)FCM|APNS", message = "El tipo de token debe ser FCM o APNS.")
        String tipoToken
) {
}
