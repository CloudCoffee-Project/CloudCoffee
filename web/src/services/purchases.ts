import type { CartItem } from './catalog';
import { ApiRequestError, request } from './httpClient';

export interface PurchaseRequestItem {
  ofertaId: string;
  cantidad: number;
}

export interface PurchaseOrder {
  ordenId: string;
  cafeteriaNombre: string;
  estado: string;
  montoTotal: number;
}

export interface Purchase {
  compraId: string;
  estado: string;
  montoTotal: number;
  moneda: string;
  ordenes: PurchaseOrder[];
  reservaExpiraAt: string;
  pago: unknown | null;
}

export interface PendingPurchaseCreation {
  idempotencyKey: string;
  items: PurchaseRequestItem[];
  cartSnapshot: CartItem[];
}

type PurchaseAction = 'confirmar' | 'cancelar';

const pendingCreationKey = 'checkout:pending-creation';
const savedPurchaseKey = 'checkout:last-purchase';

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function createPurchase(
  items: PurchaseRequestItem[],
  idempotencyKey: string,
): Promise<Purchase> {
  return request<Purchase>('/v1/compras', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ items }),
  });
}

export function confirmPurchase(compraId: string, idempotencyKey: string): Promise<Purchase> {
  return request<Purchase>(`/v1/compras/${encodeURIComponent(compraId)}/confirmar`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function cancelPurchase(compraId: string, idempotencyKey: string): Promise<Purchase> {
  return request<Purchase>(`/v1/compras/${encodeURIComponent(compraId)}/cancelar`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function readPendingPurchaseCreation(): PendingPurchaseCreation | null {
  const raw = sessionStorage.getItem(pendingCreationKey);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'idempotencyKey' in parsed &&
      typeof parsed.idempotencyKey === 'string' &&
      'items' in parsed &&
      Array.isArray(parsed.items) &&
      'cartSnapshot' in parsed &&
      Array.isArray(parsed.cartSnapshot)
    ) {
      return parsed as PendingPurchaseCreation;
    }
  } catch {
    return null;
  }
  return null;
}

export function savePendingPurchaseCreation(intent: PendingPurchaseCreation): void {
  sessionStorage.setItem(pendingCreationKey, JSON.stringify(intent));
}

export function clearPendingPurchaseCreation(): void {
  sessionStorage.removeItem(pendingCreationKey);
}

export function readSavedPurchase(): Purchase | null {
  const raw = sessionStorage.getItem(savedPurchaseKey);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPurchase(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePurchase(purchase: Purchase): void {
  sessionStorage.setItem(savedPurchaseKey, JSON.stringify(purchase));
}

export function clearSavedPurchase(): void {
  sessionStorage.removeItem(savedPurchaseKey);
}

export function getPurchaseActionKey(compraId: string, action: PurchaseAction): string {
  const storageKey = `checkout:${compraId}:${action}`;
  const existingKey = sessionStorage.getItem(storageKey);
  if (existingKey) return existingKey;

  const idempotencyKey = newIdempotencyKey();
  sessionStorage.setItem(storageKey, idempotencyKey);
  return idempotencyKey;
}

export function clearPurchaseActionKey(compraId: string, action: PurchaseAction): void {
  sessionStorage.removeItem(`checkout:${compraId}:${action}`);
}

export function shouldReuseIdempotencyKey(error: unknown): boolean {
  return error instanceof ApiRequestError && (
    error.status === null ||
    error.status === 503 ||
    error.code === 'IDEMPOTENCY_IN_PROGRESS'
  );
}

export function isPurchase(value: unknown): value is Purchase {
  return typeof value === 'object' && value !== null &&
    'compraId' in value && typeof value.compraId === 'string' &&
    'estado' in value && typeof value.estado === 'string' &&
    'montoTotal' in value && typeof value.montoTotal === 'number' &&
    'moneda' in value && typeof value.moneda === 'string' &&
    'ordenes' in value && Array.isArray(value.ordenes) &&
    'reservaExpiraAt' in value && typeof value.reservaExpiraAt === 'string' &&
    'pago' in value;
}
