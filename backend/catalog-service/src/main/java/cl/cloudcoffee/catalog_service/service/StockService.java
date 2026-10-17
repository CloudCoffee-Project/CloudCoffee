package cl.cloudcoffee.catalog_service.service;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.messaging.CloudCoffeeEvent;
import cl.cloudcoffee.catalog_service.messaging.RabbitTopologyConfig;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;

/**
 * INT2-77: un pago aprobado confirma la venta y descuenta el stock reservado.
 * Cada eventId se aplica una sola vez, aunque RabbitMQ lo entregue de nuevo.
 */
@Service
public class StockService {

    private static final Logger LOGGER = LoggerFactory.getLogger(StockService.class);

    private final OfferRepository offerRepository;
    private final JdbcTemplate jdbc;

    public StockService(OfferRepository offerRepository, JdbcTemplate jdbc) {
        this.offerRepository = offerRepository;
        this.jdbc = jdbc;
    }

    /** Devuelve true si aplicó el evento; false si era repetido o de otro tipo. */
    @Transactional
    public boolean confirmarVenta(CloudCoffeeEvent event) {
        if (event == null || event.eventId() == null || event.payload() == null) {
            throw new IllegalArgumentException("El evento no contiene los metadatos obligatorios");
        }
        if (!RabbitTopologyConfig.PAGO_APROBADO_EVENT.equals(event.eventType())) {
            return false;
        }
        Integer procesados = jdbc.queryForObject(
                "SELECT COUNT(*) FROM eventos_procesados WHERE event_id = ?", Integer.class, event.eventId());
        if (procesados != null && procesados > 0) {
            LOGGER.info("Evento ya procesado (idempotencia): eventId={}, traceId={}", event.eventId(), event.traceId());
            return false;
        }
        // La clave primaria cubre dos entregas simultáneas: una de ellas falla y se reintenta.
        jdbc.update("INSERT INTO eventos_procesados (event_id, event_type, procesado_en) VALUES (?, ?, ?)",
                event.eventId(), event.eventType(), Timestamp.from(Instant.now()));

        for (Map<?, ?> item : items(event)) {
            UUID ofertaId = UUID.fromString(String.valueOf(item.get("ofertaId")));
            int cantidad = ((Number) item.get("cantidad")).intValue();
            offerRepository.findForUpdate(ofertaId).ifPresentOrElse(offer -> {
                if (offer.getStock() < cantidad) {
                    // Sobreventa: no debería ocurrir si la reserva retuvo el stock.
                    LOGGER.warn("Stock insuficiente al confirmar: ofertaId={}, stock={}, cantidad={}, eventId={}",
                            ofertaId, offer.getStock(), cantidad, event.eventId());
                }
                offer.setStock(Math.max(0, offer.getStock() - cantidad));
            }, () -> LOGGER.warn("Oferta inexistente al confirmar venta: ofertaId={}, eventId={}",
                    ofertaId, event.eventId()));
        }
        LOGGER.info("Venta confirmada: eventId={}, traceId={}, compraId={}",
                event.eventId(), event.traceId(), event.payload().get("compraId"));
        return true;
    }

    private static List<Map<?, ?>> items(CloudCoffeeEvent event) {
        Object items = event.payload().get("items");
        if (!(items instanceof List<?> lista)) {
            throw new IllegalArgumentException("El evento " + event.eventId() + " no trae items");
        }
        return lista.stream().<Map<?, ?>>map(item -> (Map<?, ?>) item).toList();
    }
}
