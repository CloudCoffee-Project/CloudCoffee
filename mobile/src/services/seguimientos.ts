// src/services/seguimientos.ts
//
// Seguimientos de productos del cliente (INT4-45): lista los productos que el
// usuario autenticado sigue —para enterarse cuando vuelven a estar disponibles
// tras agotarse— y permite eliminarlos. El concepto es distinto del seguimiento
// en vivo de una orden (pantalla (cliente)/seguimientos.tsx, INT4-44).
//
// Contrato (doc del equipo, app móvil, JWT de cliente):
//   - GET    /v1/catalog/seguimientos            → lista los seguimientos.
//   - POST   /v1/catalog/seguimientos            → suscribe (creación, INT4-53).
//   - DELETE /v1/catalog/seguimientos/{id}       → elimina un seguimiento.
//
// El gateway ya enruta /v1/catalog/** (mismo prefijo que usan categorías y
// productos), así que la ruta de acá es la canónica. El catalog-service todavía
// no implementa el controller de /seguimientos: consumimos el contrato real y,
// si el gateway responde con problem+json, la pantalla muestra el error
// normalizado vía toApiError, igual que en ordenes.ts.
//
// El httpClient inyecta el JWT del cliente en cada petición (interceptor), así
// que estas funciones no reciben el token explícitamente (patrón de auth.ts).

import { httpClient } from './httpClient';
import type { Seguimiento } from '../types/domain';

// Ruta del dominio de seguimientos dentro del gateway.
// TODO: el catalog-service todavía no expone el controller de /seguimientos
// (el doc los define como "solo app móvil", aún sin implementar en el backend).
// El GET real del contrato acepta page y size; hoy la pantalla lista todo en
// una sola petición, así que el listado no los envía todavía.
export const SEGUIMIENTOS_ENDPOINT = '/v1/catalog/seguimientos';

/** Llama a GET /v1/catalog/seguimientos y devuelve los seguimientos del cliente. */
export async function listarSeguimientos(): Promise<Seguimiento[]> {
  const response = await httpClient.get<Seguimiento[]>(SEGUIMIENTOS_ENDPOINT);

  return response.data;
}

/** Llama a DELETE /v1/catalog/seguimientos/{id} y deja de seguir el producto. */
export async function eliminarSeguimiento(id: string): Promise<void> {
  await httpClient.delete(`${SEGUIMIENTOS_ENDPOINT}/${id}`);
}
