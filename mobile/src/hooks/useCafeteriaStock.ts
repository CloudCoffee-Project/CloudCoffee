// src/hooks/useCafeteriaStock.ts
import { useEffect, useState } from 'react';

import { subscribeToTopic, topicCafeteriaStock } from '../services/websocket';
import type { StockCafeteriaEvento } from '../types/domain';

// Se suscribe al stock en tiempo real de una cafetería y devuelve
// un mapa { ofertaId: stockActual } que se actualiza solo.
export function useCafeteriaStock(cafeteriaId: string): Record<string, number> {
  const [stockPorOferta, setStockPorOferta] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!cafeteriaId) return;

    const unsubscribe = subscribeToTopic(topicCafeteriaStock(cafeteriaId), (message) => {
      try {
        const evento = JSON.parse(message.body) as StockCafeteriaEvento;
        const payload = evento?.payload;
        if (typeof payload?.ofertaId !== 'string' || typeof payload.stockActual !== 'number') {
          return;
        }
        setStockPorOferta((prev) => ({
          ...prev,
          [payload.ofertaId]: payload.stockActual,
        }));
      } catch {
        // Mensaje malformado o sin envelope: se ignora y se espera el siguiente.
      }
    });

    return unsubscribe;
  }, [cafeteriaId]);

  return stockPorOferta;
}
