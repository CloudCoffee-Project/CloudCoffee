// src/services/ordenes.ts
//
// Órdenes del cajero: listado ("Pedidos Entrantes", INT4-7), confirmación de
// entrega tras escanear el QR de retiro (INT4-8) y resolución de órdenes no
// retiradas con decisión ítem por ítem (INT4-12). Todo el tráfico pasa por el
// httpClient del API Gateway (config/api.ts): el interceptor inyecta el token
// y los errores llegan normalizados como ApiError (toApiError).

import { httpClient } from './httpClient';
import type { AccionNoRetirado, Orden } from '../types/domain';

// Ruta del dominio de órdenes dentro del gateway.
// TODO: el gateway todavía no rutea /orders (application.properties solo
// expone /v1/auth, /v1/catalog y /v1/notifications). Cuando se negocie el
// contrato con el backend, ajustar esta ruta en un solo lugar.
export const ORDENES_ENDPOINT = '/v1/orders';

export async function fetchPedidosEntrantes(accessToken: string): Promise<Orden[]> {
  const response = await httpClient.get<Orden[]>(ORDENES_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.data;
}

// Marca una orden como entregada tras validar el QR de retiro (INT4-8).
// Mismo contrato TODO que fetchPedidosEntrantes: el endpoint no existe aún en
// el backend, pero el cajero ya consume el contrato real y muestra el error
// normalizado si el gateway responde con problem+json.
export async function marcarOrdenEntregada(ordenId: string, accessToken: string): Promise<Orden> {
  const response = await httpClient.post<Orden>(
    `${ORDENES_ENDPOINT}/${ordenId}/entregar`,
    undefined,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return response.data;
}

// Decisión de un ítem de una orden no retirada pendiente de revisión (INT4-12):
// 'reingresar' vuelve las unidades al stock, 'descartar' las da de baja. La
// acción siempre es un valor del union AccionNoRetirado (dominio), nunca un
// string plano definido en la pantalla.
export interface DecisionItemNoRetirado {
  ordenItemId: string;
  accion: AccionNoRetirado;
}

export interface ResolverNoRetiradoRequest {
  items: DecisionItemNoRetirado[];
}

// Envía la resolución de una orden no retirada pendiente de revisión (INT4-12)
// con la decisión ítem por ítem. Mismo contrato TODO que el resto de /orders:
// el endpoint no existe aún en el backend (el gateway no rutea /orders), pero
// el cajero ya consume el contrato real y muestra el error normalizado si el
// gateway responde con problem+json.
export async function resolverOrdenNoRetirada(
  ordenId: string,
  decisiones: DecisionItemNoRetirado[],
  accessToken: string
): Promise<Orden> {
  const response = await httpClient.post<Orden>(
    `${ORDENES_ENDPOINT}/${ordenId}/no-retirado/revisar`,
    { items: decisiones } satisfies ResolverNoRetiradoRequest,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return response.data;
}
