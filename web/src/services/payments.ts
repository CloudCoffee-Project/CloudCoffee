import { ApiRequestError, request } from './httpClient';
import { getPurchaseActionKey } from './purchases';
import { decodeSessionToken } from '../utils/jwt';

export function paymentSessionOwner(): string | null {
  return decodeSessionToken(localStorage.getItem('accessToken') ?? '')?.userId ?? null;
}

export interface Payment {
  pagoId: string;
  compraId: string;
  estado: string;
  motivo?: string | null;
  simulado: boolean;
  proveedor: string;
  entorno?: string;
  initPoint?: string | null;
  expiraAt?: string | null;
}

function paymentPath(compraId: string) {
  return `/v1/compras/${encodeURIComponent(compraId)}/pago`;
}

export function getPayment(compraId: string, signal?: AbortSignal): Promise<Payment> {
  return request(paymentPath(compraId), { signal });
}

export function startPayment(compraId: string, signal?: AbortSignal): Promise<Payment> {
  return request(paymentPath(compraId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': getPurchaseActionKey(compraId, 'pagar-sandbox'),
    },
    body: JSON.stringify({ canalRetorno: 'web' }),
    signal,
  });
}

export function isPaymentNotStarted(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 404 && error.code === 'PAGO_NO_ENCONTRADO';
}

export function isPaymentReconciling(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 503 && error.code === 'PAGO_EN_CONCILIACION';
}

export function assertSandboxPayment(payment: Payment, compraId: string): void {
  if (payment.compraId !== compraId || payment.simulado !== false ||
      payment.proveedor !== 'mercadopago_sandbox' || payment.entorno !== 'sandbox') {
    throw new Error('El servidor no devolvió un pago de Mercado Pago Sandbox para esta compra.');
  }
}

export function sandboxCheckoutUrl(payment: Payment): string | null {
  if (payment.estado !== 'pendiente' || !payment.initPoint) return null;
  if (payment.expiraAt && Date.parse(payment.expiraAt) <= Date.now()) return null;

  const url = new URL(payment.initPoint);
  const officialHost = ['mercadopago.cl', 'mercadopago.com'].some(
    domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );
  if (url.protocol !== 'https:' || !officialHost || url.port || url.username || url.password) {
    throw new Error('El enlace de pago de Mercado Pago no es válido.');
  }
  return url.href;
}

export function openMercadoPagoCheckout(url: string): void {
  window.location.assign(url);
}
