// src/services/notificacionesStock.ts
//
// Eventos de stock en tiempo real (INT4-46): transforma los mensajes del
// topic /topic/cafeteria/{cafeteriaId}/stock en notificaciones de producto
// "agotado" o "disponible" para la bandeja local y el banner in-app.
//
// El evento (StockCafeteriaEvento) no trae el nombre del producto ni de la
// cafetería, por eso los textos son genéricos; cuando el catálogo real
// entregue ofertas con stock/disponible, estos helpers se reutilizan sin
// tocar las pantallas.

import type { StockCafeteriaEvento } from '../types/domain';
import type { NotificacionHistorial } from './historialNotificaciones';

export type EstadoStockNotificable = 'agotado' | 'disponible';

// stockActual <= 0 se considera agotado; cualquier valor mayor es disponible.
export function estadoDeStock(stockActual: number): EstadoStockNotificable {
  return stockActual <= 0 ? 'agotado' : 'disponible';
}

// Detecta un cambio de estado notificable entre el stock anterior conocido y
// el actual. Devuelve null cuando no hay transición:
//   - mismo estado que el anterior, o
//   - primer evento con stock disponible (solo fija la línea base).
// El primer evento con stock agotado sí notifica: informa el estado actual.
export function transicionDeStock(
  anterior: number | null | undefined,
  actual: number
): EstadoStockNotificable | null {
  if (anterior == null) {
    return estadoDeStock(actual) === 'agotado' ? 'agotado' : null;
  }
  const estadoAnterior = estadoDeStock(anterior);
  const estadoActual = estadoDeStock(actual);
  return estadoAnterior === estadoActual ? null : estadoActual;
}

// Construye la entrada de la bandeja para un evento de stock. El id incluye
// el estado y la oferta: eventos repetidos con el mismo estado reemplazan la
// entrada previa (agregarNotificacion deduplica por id).
export function notificacionDeEventoStock(
  evento: StockCafeteriaEvento,
  tipo: EstadoStockNotificable
): NotificacionHistorial {
  const agotado = tipo === 'agotado';
  return {
    id: `stock-${tipo}-${evento.ofertaId}`,
    titulo: agotado ? 'Producto agotado' : 'Producto disponible',
    cuerpo: agotado
      ? 'Un producto de la cafetería se quedó sin stock.'
      : 'Un producto de la cafetería volvió a estar disponible.',
    url: null,
    leida: false,
    fechaIso: new Date().toISOString(),
  };
}
