package cl.cloudcoffee.payment_service.pagos;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CopyOnWriteArrayList;

import cl.cloudcoffee.payment_service.messaging.CanalEventos;

/** Broker controlado: registra cada envío y responde con los fallos programados (por defecto confirma). */
class CanalControlado implements CanalEventos {

    record Enviado(String exchange, String routingKey, UUID eventId, String cuerpo, String motivoDlq, boolean confirmado) {
    }

    final List<Enviado> enviados = new CopyOnWriteArrayList<>();
    final ConcurrentLinkedDeque<Envio> respuestas = new ConcurrentLinkedDeque<>();
    volatile String caidoCon;

    void reiniciar() {
        enviados.clear();
        respuestas.clear();
        caidoCon = null;
    }

    @Override
    public Envio enviar(String exchange, String routingKey, UUID eventId, String cuerpo, String motivoDlq) {
        Envio respuesta = caidoCon != null ? Envio.fallo(caidoCon) : respuestas.isEmpty() ? Envio.ok() : respuestas.poll();
        enviados.add(new Enviado(exchange, routingKey, eventId, cuerpo, motivoDlq, respuesta.confirmado()));
        return respuesta;
    }
}
