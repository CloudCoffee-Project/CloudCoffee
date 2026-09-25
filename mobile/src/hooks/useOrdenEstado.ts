// src/hooks/useOrdenEstado.ts
import { useEffect, useState } from 'react';

import { subscribeToTopic, topicOrdenEstado } from '../services/websocket';
import type { EstadoOrden, OrdenEstadoEvento } from '../types/domain';

// Se suscribe al estado en tiempo real de una orden y lo devuelve.
// Mientras no llega ningún evento, devuelve null (el consumidor muestra
// el estado base de la Orden recibida por HTTP).
export function useOrdenEstado(ordenId: string): EstadoOrden | null {
  const [estado, setEstado] = useState<EstadoOrden | null>(null);

  useEffect(() => {
    if (!ordenId) return;

    const unsubscribe = subscribeToTopic(topicOrdenEstado(ordenId), (message) => {
      try {
        const evento = JSON.parse(message.body) as OrdenEstadoEvento;
        setEstado(evento.estado);
      } catch {
        // Mensaje malformado: se ignora y se espera el siguiente evento.
      }
    });

    return unsubscribe;
  }, [ordenId]);

  return estado;
}
