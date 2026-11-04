package cl.cloudcoffee.order_service.creacion;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Puerto interno; no recibe JWT de usuario ni importes elegidos por el comprador. */
public interface CatalogoCompras {
    record Oferta(UUID ofertaId, UUID productoId, String productoNombre, UUID cafeteriaId,
            String cafeteriaNombre, UUID campusId, BigDecimal precioUnitario) {}
    record Reserva(UUID reservationId, UUID orderId, UUID offerId, UUID attemptId,
            int quantity, String status, Instant reservedAt, Instant expiresAt) {}
    List<Oferta> cotizar(List<UUID> ofertas);
    Reserva reservar(UUID ordenId, UUID ofertaId, int cantidad, UUID intento, Instant vence, BigDecimal precio);
    void liberar(UUID reservaId);

    /** Solo estos fallos de negocio tienen significado conocido para Order. */
    class Rechazo extends RuntimeException {
        public final String code;
        public Rechazo(String code) { super(code); this.code = code; }
    }
    class NoDisponible extends RuntimeException {
        public NoDisponible() { super("Catalog no disponible"); }
    }
}
