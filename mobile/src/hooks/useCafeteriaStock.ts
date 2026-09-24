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
        setStockPorOferta((prev) => ({
          ...prev,
          [evento.ofertaId]: evento.stockActual,
        }));
      } catch {
        // Mensaje malformado: se ignora y se espera el siguiente evento.
      }
    });

    return unsubscribe;
  }, [cafeteriaId]);

  return stockPorOferta;
}
