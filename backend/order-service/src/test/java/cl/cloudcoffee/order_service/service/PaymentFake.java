package cl.cloudcoffee.order_service.service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CopyOnWriteArrayList;

import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.pasarela.PasarelaPago;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * payment-service controlado: deduplica por Idempotency-Key como la API real (misma clave, misma intención) y
 * permite programar fallos y el estado que devuelve la consulta.
 */
class PaymentFake implements PasarelaPago {

    record Llamada(UUID clave, String cuerpo) {
    }

    final List<Llamada> llamadas = new CopyOnWriteArrayList<>();
    final ConcurrentLinkedDeque<Inicio> respuestas = new ConcurrentLinkedDeque<>();
    final Map<UUID, Checkout> porClave = new ConcurrentHashMap<>();
    final Map<UUID, Checkout> porCompra = new ConcurrentHashMap<>();
    final Map<UUID, Consulta> consultas = new ConcurrentHashMap<>();
    volatile long demoraMs;
    private final JsonMapper json = JsonMapper.builder().build();

    void reset() {
        llamadas.clear();
        respuestas.clear();
        porClave.clear();
        porCompra.clear();
        consultas.clear();
        demoraMs = 0;
    }

    @Override
    public String proveedor() {
        return Pago.PROVEEDOR_SANDBOX;
    }

    @Override
    public boolean esExterna() {
        return true;
    }

    @Override
    public RegistroPasarela registrar(SolicitudPago solicitud) {
        throw new UnsupportedOperationException();
    }

    @Override
    public Inicio iniciarCheckout(SolicitudCheckout solicitud) {
        llamadas.add(new Llamada(solicitud.claveIdempotencia(), solicitud.cuerpo()));
        if (demoraMs > 0) {
            try { Thread.sleep(demoraMs); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        Inicio programada = respuestas.poll();
        if (programada != null) return programada;
        Checkout checkout = porClave.computeIfAbsent(solicitud.claveIdempotencia(), clave -> {
            JsonNode body = json.readTree(solicitud.cuerpo());
            UUID paymentId = UUID.randomUUID();
            return new Checkout(paymentId, UUID.fromString(body.path("compraId").asString()),
                    UUID.fromString(body.path("clienteId").asString()), "pref-" + paymentId,
                    "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-" + paymentId, "pendiente",
                    body.path("montoTotal").asLong(), 2);
        });
        porCompra.put(checkout.compraId(), checkout);
        return new CheckoutListo(checkout);
    }

    @Override
    public Consulta consultarCheckout(UUID compraId) {
        Consulta programada = consultas.get(compraId);
        if (programada != null) return programada;
        Checkout checkout = porCompra.get(compraId);
        return checkout == null ? new CheckoutInexistente() : new CheckoutEncontrado(checkout);
    }

    /** Fija lo que Payment devuelve al consultar la compra (estado y versión de la intención). */
    void estado(UUID compraId, String estado, long version) {
        Checkout actual = porCompra.get(compraId);
        consultas.put(compraId, new CheckoutEncontrado(new Checkout(actual.paymentId(), actual.compraId(),
                actual.clienteId(), actual.preferenciaId(), actual.initPoint(), estado, actual.montoTotal(), version)));
    }
}
