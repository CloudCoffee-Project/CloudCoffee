package cl.cloudcoffee.notification_service.history;

import java.util.Map;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.notification_service.devices.DeviceTokenRepository;

/**
 * INT2-129 (contrato INT2-109): al recibir {@code auth.usuario.anonimizado.v1}, Notification retira los
 * dispositivos de la cuenta y borra sus datos personales del historial. Repetirlo no cambia nada.
 */
@Service
public class CuentaAnonimizadaService {

    private final DeviceTokenRepository dispositivos;
    private final NotificationHistoryRepository historial;

    public CuentaAnonimizadaService(DeviceTokenRepository dispositivos, NotificationHistoryRepository historial) {
        this.dispositivos = dispositivos;
        this.historial = historial;
    }

    public record Resultado(long dispositivos, long eventos) {
    }

    @Transactional
    public Resultado aplicar(UUID usuarioId) {
        long eliminados = dispositivos.deleteByUserId(usuarioId);
        String id = usuarioId.toString();
        long anonimizados = 0;
        for (NotificationHistory evento : historial.findAllByEventTypeStartingWith("auth.")) {
            if (perteneceA(evento.getPayload(), id) && evento.anonimizarDatosPersonales()) anonimizados++;
        }
        return new Resultado(eliminados, anonimizados);
    }

    // Los eventos de Auth identifican a la cuenta como userId (registro, verificación, recuperación)
    // o usuarioId (invitación).
    private static boolean perteneceA(Map<String, Object> payload, String usuarioId) {
        return usuarioId.equalsIgnoreCase(String.valueOf(payload.get("userId")))
                || usuarioId.equalsIgnoreCase(String.valueOf(payload.get("usuarioId")));
    }
}
