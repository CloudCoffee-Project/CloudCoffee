package cl.cloudcoffee.payment_service.pagos;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import cl.cloudcoffee.payment_service.mercadopago.ProveedorPagos;

/** Proveedor de pagos con estado para las pruebas: cada pago se consulta tal como está "ahora" en el proveedor. */
class PagosControlados implements ProveedorPagos {

    final Map<String, Consulta> consultas = new ConcurrentHashMap<>();
    final Map<String, List<PagoProveedor>> porReferencia = new ConcurrentHashMap<>();
    final AtomicInteger consultasHechas = new AtomicInteger();
    final AtomicInteger busquedasHechas = new AtomicInteger();
    volatile boolean caido;
    volatile long demoraMs;

    void reiniciar() {
        consultas.clear();
        porReferencia.clear();
        consultasHechas.set(0);
        busquedasHechas.set(0);
        caido = false;
        demoraMs = 0;
    }

    /** Publica (o actualiza) el pago en el "proveedor": visible por ID y por referencia. */
    void publicar(PagoProveedor pago) {
        consultas.put(pago.id(), new Encontrado(pago));
        if (pago.referenciaExterna() != null) {
            porReferencia.compute(pago.referenciaExterna(), (ref, lista) -> {
                var nueva = new CopyOnWriteArrayList<PagoProveedor>(lista == null ? List.of() : lista);
                nueva.removeIf(existente -> existente.id().equals(pago.id()));
                nueva.add(pago);
                return nueva;
            });
        }
    }

    @Override
    public Consulta consultar(String pagoId) {
        consultasHechas.incrementAndGet();
        esperar();
        if (caido) return new Fallida("proveedor caído");
        return consultas.getOrDefault(pagoId, new NoEncontrado());
    }

    @Override
    public Busqueda buscarPorReferencia(String referenciaExterna) {
        busquedasHechas.incrementAndGet();
        esperar();
        if (caido) return new Fallida("proveedor caído");
        return new Pagos(List.copyOf(porReferencia.getOrDefault(referenciaExterna, List.of())));
    }

    private void esperar() {
        if (demoraMs <= 0) return;
        try {
            Thread.sleep(demoraMs);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    static PagoProveedor pago(String id, String estado, String referencia, String monto, String moneda, Boolean live,
            Instant aprobado, Instant actualizado) {
        String evidencia = "{\"id\":\"" + id + "\",\"status\":\"" + estado + "\",\"transaction_amount\":" + monto + "}";
        return new PagoProveedor(id, estado, null, referencia, new BigDecimal(monto), moneda, live, aprobado,
                actualizado, evidencia);
    }
}
