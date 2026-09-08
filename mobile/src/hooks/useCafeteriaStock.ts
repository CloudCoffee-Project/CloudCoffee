// src/hooks/useCafeteriaStock.ts
import { useEffect, useState } from 'react';
import { subscribeToTopic } from '../services/websocket';

interface StockActualizado {
  ofertaId: string;
  productoId: string;
  cafeteriaId: string;
  campusId: string;
  stockActual: number;
}

// Se suscribe al stock en tiempo real de una cafetería y devuelve
// un mapa { ofertaId: stockActual } que se actualiza solo.
export function useCafeteriaStock(cafeteriaId: string) {
  const [stockPorOferta, setStockPorOferta] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!cafeteriaId) return;

    const topic = `/topic/cafeteria/${cafeteriaId}/stock`;

    const unsubscribe = subscribeToTopic(topic, (message) => {
      try {
        const data: StockActualizado = JSON.parse(message.body);
        setStockPorOferta((prev) => ({
          ...prev,
          [data.ofertaId]: data.stockActual,
        }));
      } catch (error) {
        console.error('Error parseando mensaje de stock:', error);
      }
    });

    return unsubscribe;
  }, [cafeteriaId]);

  return stockPorOferta;
}