// src/services/pagos.ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

import { httpClient } from './httpClient';

const DEEP_LINK_RETORNO = 'cloudcoffee://pago/retorno';

export interface ItemCarrito {
  ofertaId: string;
  cantidad: number;
}

export interface CompraCreada {
  compraId: string;
  estado: 'pendiente de pago' | 'revisión requerida';
  initPoint?: string;
  montoTotal: number;
}

export async function crearCompra(
  items: ItemCarrito[],
  accessToken: string
): Promise<CompraCreada> {
  const response = await httpClient.post<CompraCreada>(
    '/v1/compras',
    { items },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

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
