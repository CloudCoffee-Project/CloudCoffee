package cl.cloudcoffee.order_service.dto;

import java.time.Instant;
import java.util.UUID;

public record QrRetiroResponse(UUID ordenId, String codigo, Instant expiraAt) {
    @Override
    public String toString() {
        return "QrRetiroResponse[ordenId=" + ordenId + ", expiraAt=" + expiraAt + "]";
    }
}
