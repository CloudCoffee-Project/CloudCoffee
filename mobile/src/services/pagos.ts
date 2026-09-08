// src/services/pagos.ts
import * as WebBrowser from 'expo-web-browser';

// URL configurable vía variable de entorno (ver .env). Fallback solo para desarrollo
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080';
const DEEP_LINK_RETORNO = 'cloudcoffee://payment/retorno';

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
  const response = await fetch(`${API_URL}/v1/compras`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    throw new Error(`Error al crear la compra: ${response.status}`);
  }

  return response.json();
}

export type ResultadoCheckout =
  | { tipo: 'retorno_recibido'; url: string }
  | { tipo: 'cerrado_sin_confirmar' };

export async function abrirCheckoutMercadoPago(
  initPoint: string
): Promise<ResultadoCheckout> {
  console.log('[Pagos] Abriendo checkout embebido:', initPoint);

  const result = await WebBrowser.openAuthSessionAsync(initPoint, DEEP_LINK_RETORNO);

  if (result.type === 'success' && 'url' in result) {
    return { tipo: 'retorno_recibido', url: result.url };
  }

  // 'cancel' o 'dismiss': el usuario cerró el navegador antes de completar
  console.log('[Pagos] Usuario cerró el navegador sin confirmar');
  return { tipo: 'cerrado_sin_confirmar' };
}