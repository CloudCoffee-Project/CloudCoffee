// src/services/ordenes.ts
//
// Órdenes del cajero: listado ("Pedidos Entrantes", INT4-7), confirmación de
// entrega tras escanear el QR de retiro (INT4-8) y resolución de órdenes no
// retiradas con decisión ítem por ítem (INT4-12). Además, las acciones del
// cliente sobre una orden puntual de su compra: confirmar o cancelar (INT4-37,
// las dos últimas funciones del archivo). Todo el tráfico pasa por el httpClient
// del API Gateway (config/api.ts): el interceptor inyecta el token y los errores
// llegan normalizados como ApiError (toApiError).

import { httpClient } from './httpClient';
import type { AccionNoRetirado, Orden, PaginaOrdenes } from '../types/domain';

// Ruta del dominio de órdenes dentro del gateway.
// El gateway sí rutea /v1/orders/** hacia order-service (StripPrefix=1), pero
// order-service todavía no expone el listado GET /orders: la petición responde
// 404 (o 401 sin token) y la pantalla muestra la degradación verificada, sin
// datos simulados. Cuando exista el controlador, esta ruta ya es la correcta.
export const ORDENES_ENDPOINT = '/v1/orders';

// El contrato limita `size` a 100 (y usa 20 por defecto). El cajero necesita la
// cola completa para filtrar por estado en pantalla, así que pide la página más
// grande y recorre las siguientes hasta `last`.
export const ORDENES_TAMANO_PAGINA = 100;

// Tope defensivo: si el backend devolviera una paginación inconsistente (por
// ejemplo `last` siempre en false), no dejamos la pantalla pidiendo páginas sin
// fin. Con 100 órdenes por página cubre 5.000 órdenes, muy por encima de la
// cola real de una cafetería.
const MAX_PAGINAS = 50;

async function fetchPaginaOrdenes(page: number, accessToken: string): Promise<PaginaOrdenes> {
  const response = await httpClient.get<PaginaOrdenes>(ORDENES_ENDPOINT, {
    params: { page, size: ORDENES_TAMANO_PAGINA },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.data;
}

// Listado de pedidos entrantes del cajero. Consume el contrato real
// (PaginaOrdenes): arma la cola completa recorriendo las páginas y devuelve solo
// el `content`. Los filtros de la pantalla trabajan sobre ese arreglo, con los
// estados del union EstadoOrden; si la ruta no responde, el error normalizado
// sube tal cual (la pantalla lo traduce a un mensaje claro).
export async function fetchPedidosEntrantes(accessToken: string): Promise<Orden[]> {
  const ordenes: Orden[] = [];

  for (let page = 0; page < MAX_PAGINAS; page += 1) {
    const pagina = await fetchPaginaOrdenes(page, accessToken);
    ordenes.push(...pagina.content);

    if (pagina.last || pagina.content.length === 0) {
      break;
    }
  }

  return ordenes;
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
// el gateway ya rutea /v1/orders/**, pero order-service aún no expone este
// endpoint; la pantalla consume el contrato real y muestra el error normalizado
// si el gateway responde con problem+json.
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

// Genera un UUID v4 para Idempotency-Key (exigido por el backend).
function generarIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// INT4-37: confirmar o cancelar UNA orden puntual de la compra del cliente (las
// que agrupan una compra cuando el pedido es en varios puntos de retiro).
// A diferencia de las funciones del cajero de arriba, estas no reciben el token
// explícito: quien las llama es la pantalla de Mis Compras y el interceptor del
// httpClient ya inyecta el JWT del cliente (mismo patrón que compras.ts).
//   - POST /v1/orders/{ordenId}/confirmar → Orden
//   - POST /v1/orders/{ordenId}/cancelar  → Orden
// Requieren Idempotency-Key (UUID). Sin body: la acción se define por la ruta.
export async function confirmarOrden(ordenId: string): Promise<Orden> {
  const response = await httpClient.post<Orden>(
    `${ORDENES_ENDPOINT}/${ordenId}/confirmar`,
    undefined,
    {
      headers: {
        'Idempotency-Key': generarIdempotencyKey(),
      },
    }
  );

  return response.data;
}

export async function cancelarOrden(ordenId: string): Promise<Orden> {
  const response = await httpClient.post<Orden>(
    `${ORDENES_ENDPOINT}/${ordenId}/cancelar`,
    undefined,
    {
      headers: {
        'Idempotency-Key': generarIdempotencyKey(),
      },
    }
  );

  return response.data;
}
