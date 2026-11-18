import { request } from './httpClient';
import { getPurchaseActionKey } from './purchases';
import { decodeSessionToken } from '../utils/jwt';

export function paymentSessionOwner(): string | null {
  return decodeSessionToken(localStorage.getItem('accessToken') ?? '')?.userId ?? null;
}

export type PaymentScenario = 'aprobar' | 'rechazar' | 'pendiente';
export interface Payment {
  pagoId: string;
  compraId: string;
  estado: string;
  motivo?: string | null;
  simulado: boolean;
  proveedor: string;
}

export function getPayment(compraId: string, signal?: AbortSignal): Promise<Payment> {
  return request(`/v1/compras/${encodeURIComponent(compraId)}/pago`, { signal });
}

export function pendingPaymentScenario(compraId: string): PaymentScenario | null {
  const value = sessionStorage.getItem(`pago-simulado:${compraId}:escenario`);
  return value === 'aprobar' || value === 'rechazar' || value === 'pendiente' ? value : null;
}

export function clearPaymentScenario(compraId: string): void {
  sessionStorage.removeItem(`pago-simulado:${compraId}:escenario`);
}

export function startPayment(compraId: string, scenario: PaymentScenario): Promise<Payment> {
  // Congelar también el cuerpo: un timeout no permite cambiar de escenario al reintentar.
  const selected = pendingPaymentScenario(compraId) ?? scenario;
  sessionStorage.setItem(`pago-simulado:${compraId}:escenario`, selected);
  return request(`/v1/compras/${encodeURIComponent(compraId)}/pago`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': getPurchaseActionKey(compraId, 'pagar'),
    },
    body: JSON.stringify({ escenario: selected }),
  });
}
