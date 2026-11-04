// src/services/compras.ts
//
// Historial de compras del cliente (INT4-50): lista las compras que el usuario
// autenticado ha realizado. Es el tab "Mis Compras" y agrupa las órdenes de
// cada compra (cada orden pagada tiene su boleta, INT4-48).
//
// Contrato (doc del equipo, app móvil, JWT de cliente):
//   - GET /v1/compras → PaginaComprasResponse (historial del cliente).
//
// El httpClient inyecta el JWT del cliente en cada petición (interceptor), así
// que esta función no recibe el token explícitamente (patrón de seguimientos.ts
// y auth.ts).

import { httpClient } from './httpClient';
import type { Compra, PaginaCompras } from '../types/domain';

// Ruta del dominio de compras dentro del gateway. Es la misma raíz que usa el
// POST de crearCompra (services/pagos.ts, INT4-35); acá queda como endpoint
// único de referencia para el dominio.
export const COMPRAS_ENDPOINT = '/v1/compras';

// Genera un UUID v4 para Idempotency-Key (exigido por el backend).
function generarIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Llama a GET /v1/compras y devuelve el historial de compras del cliente. */
export async function listarCompras(): Promise<Compra[]> {
  const response = await httpClient.get<PaginaCompras>(COMPRAS_ENDPOINT);

  return response.data.content;
}

// INT4-37: confirmar o cancelar la compra COMPLETA (todas sus órdenes) desde
// Mis Compras. Son dos endpoints distintos porque el backend tiene que decidir
// qué pasa con las órdenes ya cobradas o entregadas: la app solo le pide la
// acción y se recarga el historial para mostrar el estado que devuelva.
//   - POST /v1/compras/{compraId}/confirmar → Compra
//   - POST /v1/compras/{compraId}/cancelar  → Compra
// Requieren Idempotency-Key (UUID). Los errores llegan normalizados
// (toApiError) para que la pantalla muestre el mensaje del backend.
export async function confirmarCompra(compraId: string): Promise<Compra> {
  const response = await httpClient.post<Compra>(
    `${COMPRAS_ENDPOINT}/${compraId}/confirmar`,
    undefined,
    {
      headers: {
        'Idempotency-Key': generarIdempotencyKey(),
      },
    }
  );

  return response.data;
}

export async function cancelarCompra(compraId: string): Promise<Compra> {
  const response = await httpClient.post<Compra>(
    `${COMPRAS_ENDPOINT}/${compraId}/cancelar`,
    undefined,
    {
      headers: {
        'Idempotency-Key': generarIdempotencyKey(),
      },
    }
  );

  return response.data;
}
