package cl.cloudcoffee.order_service.revision;

import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import cl.cloudcoffee.order_service.dto.PagoResponse;
import cl.cloudcoffee.order_service.messaging.OrderEventJournal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** Se invoca dentro de la transacción que cambia los recursos y termina el comando. */
@Component
public class EventosRevision {
    private final OrderEventJournal events;
    public EventosRevision(OrderEventJournal events) { this.events = events; }

    public void orden(OrdenResponse anterior, OrdenResponse actual, UUID cliente, String trace, Instant ahora) {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("compraId", actual.compraId()); payload.put("ordenId", actual.ordenId());
        payload.put("clienteId", cliente); payload.put("cafeteriaId", actual.cafeteriaId());
        payload.put("estadoAnterior", anterior.estado()); payload.put("estado", actual.estado());
        payload.put("version", actual.version());
        guardar("order.orden.estado-cambiado.v1", payload, trace, ahora);
    }
    public void pago(PagoResponse pago, UUID cliente, String trace, Instant ahora) {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("pagoId", pago.pagoId()); payload.put("compraId", pago.compraId());
        payload.put("clienteId", cliente); payload.put("estado", pago.estado());
        payload.put("motivo", pago.motivo()); payload.put("montoTotal", pago.montoTotal());
        payload.put("moneda", pago.moneda()); payload.put("simulado", pago.simulado());
        payload.put("version", pago.version());
        guardar("order.pago.resultado.v1", payload, trace, ahora);
    }
    public void compra(CompraResponse anterior, CompraResponse actual, String trace, Instant ahora) {
        guardar("order.compra.estado-cambiado.v1", Map.of("compraId", actual.compraId(), "clienteId", actual.clienteId(),
                "estadoAnterior", anterior.estado(), "estado", actual.estado(), "montoTotal", actual.montoTotal(),
                "moneda", actual.moneda(), "version", actual.version()), trace, ahora);
    }
    private void guardar(String tipo, Map<String, Object> payload, String trace, Instant ahora) {
        events.append(tipo, payload, trace, ahora);
    }
}
