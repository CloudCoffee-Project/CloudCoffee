// src/services/pagos.ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import { httpClient } from './httpClient';
import type { EscenarioPago, Orden, Pago } from '../types/domain';

// Scheme del deep link: debe coincidir con "scheme" en app.json (cloudcoffee).
const DEEP_LINK_RETORNO = 'cloudcoffee://pago/retorno';

export interface ItemCarrito {
  ofertaId: string;
  cantidad: number;
}

// Datos de entrega y facturación que recopila el checkout (INT4-35). El contrato
// actual del backend solo acepta { items } al crear la compra; estos datos se
// mantienen por compatibilidad pero no se envían al backend.
export interface DatosEntregaCompra {
  nombre: string;
  correo: string;
  telefono: string;
  direccion?: string;
  metodoEntrega: 'retiro' | 'envio';
}

// Estado de la compra en la respuesta de POST /v1/compras (contrato order-service).
//   - 'pendiente_pago': registrada y falta el pago (pago simulado; sin initPoint
//     se confirma en Mis Compras).
//   - 'revision_requerida': registrada pero necesita revisión antes de confirmarse
//     (no está pagada ni rechazada, no se debe volver a cobrar).
export type EstadoCompraCreada = 'pendiente_pago' | 'revision_requerida';

// Constante del estado de revisión: ninguna pantalla inventa el string (ver la
// política de estados de types/domain.ts); la pantalla compara contra esta.
export const ESTADO_COMPRA_REVISION_REQUERIDA: EstadoCompraCreada = 'revision_requerida';

export interface CompraCreada {
  compraId: string;
  estado: EstadoCompraCreada;
  initPoint?: string;
  montoTotal: number;
  // El contrato actual de POST /v1/compras devuelve la Compra completa (con
  // órdenes y pago null), no el DTO viejo con initPoint. Estos campos son
  // opcionales para conservar el historial de pantallas/tests que usaban el
  // DTO anterior sin initPoint.
  ordenes?: Orden[];
  pago?: Pago | null;
}

// Genera un UUID v4 para Idempotency-Key (exigido por el backend).
function generarIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function crearCompra(
  items: ItemCarrito[],
  accessToken: string,
  _datosEntrega?: DatosEntregaCompra
): Promise<CompraCreada> {
  const response = await httpClient.post<CompraCreada>(
    '/v1/compras',
    // El precio no viaja (lo recalcula el backend contra el catálogo). El contrato
    // actual solo acepta { items }.
    { items },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Idempotency-Key': generarIdempotencyKey(),
      },
    }
  );

  return response.data;
}

// --- INT4-128: pago simulado de Order (sin proveedor externo) ----------------
//
// El checkout ya no abre un navegador de Mercado Pago: Order expone su propio
// pago simulado con tres escenarios elegibles. El resultado es definitivo y lo
// devuelve el backend; la app no decide el estado ni usa webhooks externos.
// Las funciones de MP de abajo se conservan por historial (INT4-38/39/40) pero el
// recorrido actual no las llama.
const PAGOS_ENDPOINT = '/v1/compras';

export type SimularPagoResponse = Pago;

/**
 * POST /v1/compras/{compraId}/pago con { escenario }. Requiere Idempotency-Key
 * (UUID): repetir la llamada no cambia el resultado ni crea otro pago.
 */
export async function simularPago(
  compraId: string,
  escenario: EscenarioPago
): Promise<SimularPagoResponse> {
  const response = await httpClient.post<SimularPagoResponse>(
    `${PAGOS_ENDPOINT}/${compraId}/pago`,
    { escenario },
    {
      headers: {
        'Idempotency-Key': generarIdempotencyKey(),
      },
    }
  );

  return response.data;
}

/** GET /v1/compras/{compraId}/pago: estado real del pago, sin simulación local. */
export async function consultarPago(compraId: string): Promise<SimularPagoResponse> {
  const response = await httpClient.get<SimularPagoResponse>(`${PAGOS_ENDPOINT}/${compraId}/pago`);

  return response.data;
}

export type ResultadoCheckout =
  { tipo: 'retorno_recibido'; url: string } | { tipo: 'cerrado_sin_confirmar' };

export async function abrirCheckoutMercadoPago(initPoint: string): Promise<ResultadoCheckout> {
  console.warn('[Pagos] Abriendo checkout embebido:', initPoint);

  const result = await WebBrowser.openAuthSessionAsync(initPoint, DEEP_LINK_RETORNO);

  if (result.type === 'success' && 'url' in result) {
    return { tipo: 'retorno_recibido', url: result.url };
  }

  // 'cancel' o 'dismiss': el usuario cerró el navegador antes de completar
  console.warn('[Pagos] Usuario cerró el navegador sin confirmar');
  return { tipo: 'cerrado_sin_confirmar' };
}

// --- INT4-39: parseo del deep link de retorno ---

export type EstadoPagoVisual = 'exitoso' | 'rechazado' | 'pendiente' | 'desconocido';

export interface RetornoPagoParseado {
  estado: EstadoPagoVisual;
  paymentId?: string;
  compraId?: string; // viene en external_reference, si backend lo configuró así
  preferenceId?: string;
  merchantOrderId?: string;
}

/**
 * Normaliza los distintos nombres que Mercado Pago usa para el estado
 * (status en algunos casos, collection_status en otros) a un valor único.
 *
 * IMPORTANTE: este estado es solo informativo/visual. La confirmación real
 * del pago llega por el webhook al backend, nunca por este redirect.
 * Ver nota del manual técnico, sección payment-service.
 */
function normalizarEstado(valor: string | null | undefined): EstadoPagoVisual {
  switch (valor) {
    case 'approved':
      return 'exitoso';
    case 'rejected':
      return 'rechazado';
    case 'pending':
    case 'in_process':
      return 'pendiente';
    default:
      return 'desconocido';
  }
}

/**
 * Parsea la URL de retorno recibida directamente desde
 * WebBrowser.openAuthSessionAsync (Camino A). Usa expo-linking porque esta
 * URL nunca pasa por el router de Expo: la intercepta la sesión de auth
 * antes de llegar al sistema operativo.
 */
export function parsearRetornoPago(url: string): RetornoPagoParseado {
  const { queryParams } = Linking.parse(url);

  const estadoCrudo =
    (queryParams?.status as string | undefined) ??
    (queryParams?.collection_status as string | undefined);

  return {
    estado: normalizarEstado(estadoCrudo),
    paymentId:
      (queryParams?.payment_id as string | undefined) ??
      (queryParams?.collection_id as string | undefined),
    compraId: queryParams?.external_reference as string | undefined,
    preferenceId: queryParams?.preference_id as string | undefined,
    merchantOrderId: queryParams?.merchant_order_id as string | undefined,
  };
}
