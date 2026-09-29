// src/services/compras.ts
//
// Historial de compras del cliente (INT4-50): lista las compras que el usuario
// autenticado ha realizado. Es el tab "Mis Compras" y agrupa las órdenes de
// cada compra (cada orden pagada tiene su boleta, INT4-48).
//
// Contrato (doc del equipo, app móvil, JWT de cliente):
//   - GET /v1/compras → Compra[] (historial del cliente, más recientes primero).
//
// El httpClient inyecta el JWT del cliente en cada petición (interceptor), así
// que esta función no recibe el token explícitamente (patrón de seguimientos.ts
// y auth.ts).

import { httpClient } from './httpClient';
import type { Compra } from '../types/domain';

// Ruta del dominio de compras dentro del gateway. Es la misma raíz que usa el
// POST de crearCompra (services/pagos.ts, INT4-35); acá queda como endpoint
// único de referencia para el dominio.
// TODO: el gateway no rutea /v1/compras (application.properties solo expone
// /v1/auth, /v1/catalog y /v1/notifications; order-service aún es un stub).
// La pantalla consume el contrato real y muestra el error normalizado
// (toApiError) si el gateway responde con problem+json.
export const COMPRAS_ENDPOINT = '/v1/compras';

/** Llama a GET /v1/compras y devuelve el historial de compras del cliente. */
export async function listarCompras(): Promise<Compra[]> {
  const response = await httpClient.get<Compra[]>(COMPRAS_ENDPOINT);

  return response.data;
}

// INT4-37: confirmar o cancelar la compra COMPLETA (todas sus órdenes) desde
// Mis Compras. Son dos endpoints distintos porque el backend tiene que decidir
// qué pasa con las órdenes ya cobradas o entregadas: la app solo le pide la
// acción y se recarga el historial para mostrar el estado que devuelva.
//   - POST /v1/compras/{compraId}/confirmar → Compra
//   - POST /v1/compras/{compraId}/cancelar  → Compra
// Sin body: la acción se define por la ruta. Los errores llegan normalizados
// (toApiError) para que la pantalla muestre el mensaje del backend.
export async function confirmarCompra(compraId: string): Promise<Compra> {
  const response = await httpClient.post<Compra>(`${COMPRAS_ENDPOINT}/${compraId}/confirmar`);

  return response.data;
}

export async function cancelarCompra(compraId: string): Promise<Compra> {
  const response = await httpClient.post<Compra>(`${COMPRAS_ENDPOINT}/${compraId}/cancelar`);

  return response.data;
}
