// src/services/parsearEventoStock.ts
//
// Parser de los eventos de stock del topic /topic/cafeteria/{id}/stock (INT4-138).
// Acepta las dos formas del contrato: el payload plano StockCafeteriaEvento que
// hoy emite main y el envelope CloudCoffeeEvent (eventId/eventType/payload) de
// INT4-137, para que los tests cubran el envelope aunque ese branch aún no se
// haya fusionado.
//
// Nunca lanza: cualquier mensaje que no respete el contrato devuelve null para
// que el consumidor ignore el evento y siga esperando el siguiente.

import type { StockCafeteriaEvento } from '../types/domain';

export function parsearEventoStock(body: string): StockCafeteriaEvento | null {
  let crudo: unknown;
  try {
    crudo = JSON.parse(body);
  } catch {
    return null;
  }

  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return null;
  }

  const mensaje = crudo as Record<string, unknown>;
  const payload = mensaje.payload;
  const candidato: Record<string, unknown> =
    payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : mensaje;

  const { ofertaId, stockActual, productoId, cafeteriaId, campusId } = candidato;

  // ofertaId es la clave de la línea base y stockActual determina el estado.
  if (typeof ofertaId !== 'string' || ofertaId.length === 0) {
    return null;
  }
  if (typeof stockActual !== 'number' || !Number.isFinite(stockActual)) {
    return null;
  }

  return {
    ofertaId,
    productoId: typeof productoId === 'string' ? productoId : '',
    cafeteriaId: typeof cafeteriaId === 'string' ? cafeteriaId : '',
    campusId: typeof campusId === 'string' ? campusId : '',
    stockActual,
  };
}
