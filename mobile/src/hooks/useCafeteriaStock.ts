// src/hooks/useCafeteriaStock.ts
import { useEffect, useState } from 'react';

import { parsearEventoStock } from '../services/parsearEventoStock';
import { subscribeToTopic, topicCafeteriaStock } from '../services/websocket';

// Se suscribe al stock en tiempo real de una cafetería y devuelve
// un mapa { ofertaId: stockActual } que se actualiza solo.
export function useCafeteriaStock(cafeteriaId: string): Record<string, number> {
  const [stockPorOferta, setStockPorOferta] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!cafeteriaId) return;

    const unsubscribe = subscribeToTopic(topicCafeteriaStock(cafeteriaId), (message) => {
      const evento = parsearEventoStock(message.body);
      if (!evento) return;

      setStockPorOferta((prev) => ({
        ...prev,
        [evento.ofertaId]: evento.stockActual,
      }));
    });

    return unsubscribe;
  }, [cafeteriaId]);

  return stockPorOferta;
}
