// src/hooks/useOrdenEstado.ts
import { useEffect, useState } from 'react';
import { subscribeToTopic } from '../services/websocket';

interface EstadoOrdenActualizado {
  ordenId: string;
  estado: string;
}

export function useOrdenEstado(ordenId: string) {
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!ordenId) return;

    const topic = `/topic/orden/${ordenId}/estado`;

    const unsubscribe = subscribeToTopic(topic, (message) => {
      try {
        const data: EstadoOrdenActualizado = JSON.parse(message.body);
        setEstado(data.estado);
      } catch (error) {
        console.error('Error parseando mensaje de estado de orden:', error);
      }
    });

    return unsubscribe;
  }, [ordenId]);

  return estado;
}
