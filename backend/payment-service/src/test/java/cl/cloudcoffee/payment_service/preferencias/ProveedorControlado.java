package cl.cloudcoffee.payment_service.preferencias;

import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias;

/**
 * Adaptador controlado: simula un proveedor con estado. Una respuesta perdida puede dejar la preferencia
 * creada del lado del proveedor aunque Payment no la haya recibido, como ocurriría con Mercado Pago real.
 */
class ProveedorControlado implements ProveedorPreferencias {

    enum Respuesta { CREADA, PERDIDA_TRAS_CREAR, INCIERTA_SIN_CREAR, RECHAZADA }

    final AtomicInteger creaciones = new AtomicInteger();
    final AtomicInteger busquedas = new AtomicInteger();
    final List<NuevaPreferencia> recibidas = new CopyOnWriteArrayList<>();
    final Map<String, List<Preferencia>> existentes = new ConcurrentHashMap<>();
    private final Deque<Respuesta> programadas = new ArrayDeque<>();
    volatile boolean busquedaFalla;
    volatile long demoraMs;

    synchronized void programar(Respuesta... respuestas) {
        programadas.addAll(List.of(respuestas));
    }

    synchronized void reiniciar() {
        creaciones.set(0);
        busquedas.set(0);
        recibidas.clear();
        existentes.clear();
        programadas.clear();
        busquedaFalla = false;
        demoraMs = 0;
    }

    private synchronized Respuesta siguiente() {
        return programadas.isEmpty() ? Respuesta.CREADA : programadas.poll();
    }

    /** Simula una preferencia creada en el proveedor por fuera de esta llamada (por ejemplo, un duplicado). */
    Preferencia existente(String referencia) {
        int n = existentes.values().stream().mapToInt(List::size).sum() + 100;
        var preferencia = new Preferencia("pref-" + n, referencia,
                URI.create("https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-" + n));
        existentes.computeIfAbsent(referencia, r -> new CopyOnWriteArrayList<>()).add(preferencia);
        return preferencia;
    }

    @Override
    public Creacion crear(NuevaPreferencia nueva) {
        int n = creaciones.incrementAndGet();
        recibidas.add(nueva);
        if (demoraMs > 0) {
            try { Thread.sleep(demoraMs); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        Respuesta respuesta = siguiente();
        if (respuesta == Respuesta.RECHAZADA) return new NoCreada("HTTP 400");
        if (respuesta == Respuesta.INCIERTA_SIN_CREAR) return new Incierta("timeout");
        var preferencia = new Preferencia("pref-" + n, nueva.referenciaExterna(),
                URI.create("https://www.mercadopago.cl/checkout/v1/redirect?pref_id=pref-" + n));
        existentes.computeIfAbsent(nueva.referenciaExterna(), r -> new CopyOnWriteArrayList<>()).add(preferencia);
        return respuesta == Respuesta.PERDIDA_TRAS_CREAR ? new Incierta("timeout") : new Creada(preferencia);
    }

    @Override
    public Busqueda buscar(String referenciaExterna) {
        busquedas.incrementAndGet();
        if (busquedaFalla) return new BusquedaFallida("HTTP 500");
        return new Encontradas(new ArrayList<>(existentes.getOrDefault(referenciaExterna, List.of())));
    }
}
