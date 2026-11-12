import { decodeSessionToken } from '../utils/jwt';
import {
  buildNotificationsWebSocketUrl,
  buildStompFrame,
  parseStompFrames,
  type StreamConnectionState,
} from './cashierOrders';
import type { CartItem } from './catalog';
import { ApiRequestError, request } from './httpClient';

export interface PurchaseRequestItem {
  ofertaId: string;
  cantidad: number;
}

export interface PurchaseOrder {
  ordenId: string;
  cafeteriaId?: string;
  cafeteriaNombre: string;
  estado: string;
  montoTotal: number;
  version?: number;
}

export interface Purchase {
  compraId: string;
  clienteId?: string;
  estado: string;
  montoTotal: number;
  moneda: string;
  ordenes: PurchaseOrder[];
  reservaExpiraAt: string;
  pago: unknown | null;
  version?: number;
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
export function getPurchase(compraId: string, signal?: AbortSignal): Promise<Purchase> {
  return request<Purchase>(`/v1/compras/${encodeURIComponent(compraId)}`, {
    method: 'GET',
    signal,
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

export interface PurchaseRealtimeEvent {
  eventId: string;
  traceId?: string;
  eventType: string;
  timestamp?: string;
  payload: Record<string, unknown>;
}

export interface PurchaseRealtimeStreamOptions {
  compraId: string;
  ordenIds?: string[];
  getAccessToken?: () => string | null;
  onEvent: (event: PurchaseRealtimeEvent) => void;
  onReconnect: () => void;
  onConnectionStateChange?: (state: StreamConnectionState) => void;
  reconnectDelayMs?: number;
  webSocketFactory?: (url: string) => WebSocket;
}

export interface PurchaseReconciliationResult {
  purchase: Purchase;
  applied: boolean;
  requiresHttpReconciliation: boolean;
}

const SUPPORTED_PURCHASE_EVENTS = new Set([
  'order.compra.creada.v1',
  'order.compra.estado-cambiado.v1',
  'order.pago.resultado.v1',
  'order.orden.estado-cambiado.v1',
  'order.orden.entregada.v1',
]);

export function reconcilePurchaseRealtimeEvent(
  current: Purchase,
  event: PurchaseRealtimeEvent,
): PurchaseReconciliationResult {
  const payload = event.payload;
  const payloadCompraId = typeof payload.compraId === 'string' ? payload.compraId : undefined;
  if (payloadCompraId && payloadCompraId !== current.compraId) {
    return { purchase: current, applied: false, requiresHttpReconciliation: false };
  }

  if (
    event.eventType === 'order.compra.creada.v1' ||
    event.eventType === 'order.compra.estado-cambiado.v1'
  ) {
    const incomingVersion = typeof payload.version === 'number' ? payload.version : undefined;
    if (incomingVersion !== undefined && current.version !== undefined) {
      if (incomingVersion <= current.version) {
        return { purchase: current, applied: false, requiresHttpReconciliation: false };
      }
      if (incomingVersion > current.version + 1) {
        return { purchase: current, applied: false, requiresHttpReconciliation: true };
      }
    }

    const nextEstado = typeof payload.estado === 'string' ? payload.estado : current.estado;
    const nextMontoTotal =
      typeof payload.montoTotal === 'number' ? payload.montoTotal : current.montoTotal;

    return {
      purchase: {
        ...current,
        estado: nextEstado,
        montoTotal: nextMontoTotal,
        version: incomingVersion ?? current.version,
      },
      applied: true,
      requiresHttpReconciliation: false,
    };
  }

  if (event.eventType === 'order.pago.resultado.v1') {
    const pagoEstado = typeof payload.estado === 'string' ? payload.estado : undefined;
    return {
      purchase: {
        ...current,
        pago: {
          ...(typeof current.pago === 'object' && current.pago !== null ? current.pago : {}),
          pagoId: payload.pagoId,
          estado: pagoEstado,
          motivo: payload.motivo ?? null,
          version: payload.version,
        },
      },
      applied: true,
      requiresHttpReconciliation: true,
    };
  }

  if (
    event.eventType === 'order.orden.estado-cambiado.v1' ||
    event.eventType === 'order.orden.entregada.v1'
  ) {
    const ordenId = typeof payload.ordenId === 'string' ? payload.ordenId : '';
    const orderIndex = current.ordenes.findIndex((order) => order.ordenId === ordenId);
    if (orderIndex < 0) {
      return { purchase: current, applied: false, requiresHttpReconciliation: true };
    }

    const targetOrder = current.ordenes[orderIndex];
    const incomingVersion = typeof payload.version === 'number' ? payload.version : undefined;

    if (incomingVersion !== undefined && targetOrder.version !== undefined) {
      if (incomingVersion <= targetOrder.version) {
        return { purchase: current, applied: false, requiresHttpReconciliation: false };
      }
      if (incomingVersion > targetOrder.version + 1) {
        return { purchase: current, applied: false, requiresHttpReconciliation: true };
      }
    }

    const resolvedEstado =
      typeof payload.estado === 'string'
        ? payload.estado
        : event.eventType === 'order.orden.entregada.v1'
          ? 'entregado'
          : targetOrder.estado;

    const updatedOrder: PurchaseOrder = {
      ...targetOrder,
      estado: resolvedEstado,
      version: incomingVersion ?? targetOrder.version,
    };

    const nextOrders = current.ordenes.map((order, idx) =>
      idx === orderIndex ? updatedOrder : order,
    );

    return {
      purchase: {
        ...current,
        ordenes: nextOrders,
      },
      applied: true,
      requiresHttpReconciliation: false,
    };
  }

  return { purchase: current, applied: false, requiresHttpReconciliation: false };
}

export function reconcilePurchaseFromHttp(current: Purchase | null, fetched: Purchase): Purchase {
  if (!current || current.compraId !== fetched.compraId) {
    return fetched;
  }
  if (
    current.version !== undefined &&
    fetched.version !== undefined &&
    fetched.version < current.version
  ) {
    return current;
  }
  return fetched;
}

export function connectPurchaseRealtimeStream(options: PurchaseRealtimeStreamOptions): () => void {
  const {
    compraId,
    ordenIds = [],
    getAccessToken = () => localStorage.getItem('accessToken'),
    onEvent,
    onReconnect,
    onConnectionStateChange,
    reconnectDelayMs = 3000,
    webSocketFactory = (url: string) => new WebSocket(url),
  } = options;

  const trimmedCompraId = compraId.trim();
  const uniqueOrdenIds = [...new Set(ordenIds.map((id) => id.trim()).filter(Boolean))];
  let disposed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let hasConnectedOnce = false;
  let reconnecting = false;
  const seenEventIds = new Set<string>();

  const updateState = (state: StreamConnectionState) => {
    if (!disposed) {
      onConnectionStateChange?.(state);
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== null) return;
    const token = getAccessToken()?.trim();
    if (!token || !decodeSessionToken(token)) {
      updateState('disconnected');
      return;
    }
    reconnecting = true;
    updateState('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openConnection();
    }, reconnectDelayMs);
  };

  const openConnection = () => {
    if (disposed) return;

    const wsUrl = buildNotificationsWebSocketUrl();
    const token = getAccessToken()?.trim();
    const validSession = token ? decodeSessionToken(token) : null;

    if (!wsUrl || !token || !validSession || !trimmedCompraId) {
      updateState('disconnected');
      return;
    }

    updateState(reconnecting ? 'reconnecting' : 'connecting');

    try {
      socket = webSocketFactory(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (disposed || !socket) return;
      socket.send(
        buildStompFrame('CONNECT', {
          'accept-version': '1.2',
          Authorization: `Bearer ${token}`,
        }),
      );
    };

    socket.onmessage = (messageEvent: MessageEvent) => {
      if (disposed || typeof messageEvent.data !== 'string') return;
      const frames = parseStompFrames(messageEvent.data);

      for (const frame of frames) {
        if (frame.command === 'CONNECTED') {
          const shouldReconcile = hasConnectedOnce || reconnecting;
          hasConnectedOnce = true;
          reconnecting = false;
          updateState('connected');

          socket?.send(
            buildStompFrame('SUBSCRIBE', {
              id: `sub-compra-${trimmedCompraId}`,
              destination: `/topic/compra/${trimmedCompraId}/estado`,
            }),
          );

          for (const ordenId of uniqueOrdenIds) {
            socket?.send(
              buildStompFrame('SUBSCRIBE', {
                id: `sub-orden-${ordenId}`,
                destination: `/topic/orden/${ordenId}/estado`,
              }),
            );
          }

          if (shouldReconcile) {
            onReconnect();
          }
        } else if (frame.command === 'MESSAGE' && frame.body) {
          try {
            const parsed: unknown = JSON.parse(frame.body);
            if (typeof parsed !== 'object' || parsed === null) continue;
            const raw = parsed as Record<string, unknown>;
            if (
              typeof raw.eventType !== 'string' ||
              !SUPPORTED_PURCHASE_EVENTS.has(raw.eventType) ||
              typeof raw.payload !== 'object' ||
              raw.payload === null
            ) {
              continue;
            }
            const eventId = typeof raw.eventId === 'string' ? raw.eventId : '';
            if (eventId) {
              if (seenEventIds.has(eventId)) continue;
              seenEventIds.add(eventId);
            }
            onEvent({
              eventId,
              traceId: typeof raw.traceId === 'string' ? raw.traceId : undefined,
              eventType: raw.eventType,
              timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : undefined,
              payload: raw.payload as Record<string, unknown>,
            });
          } catch {
            // Ignorar JSON malformado
          }
        } else if (frame.command === 'ERROR') {
          socket?.close();
        }
      }
    };

    socket.onerror = () => {
      // onclose gestiona reconexión
    };

    socket.onclose = () => {
      socket = null;
      if (!disposed) {
        scheduleReconnect();
      }
    };
  };

  const handleWindowOnline = () => {
    if (disposed) return;
    clearReconnectTimer();
    reconnecting = true;
    if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
      openConnection();
    } else {
      onReconnect();
    }
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', handleWindowOnline);
  }

  openConnection();

  return () => {
    disposed = true;
    clearReconnectTimer();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', handleWindowOnline);
    }
    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            buildStompFrame('UNSUBSCRIBE', {
              id: `sub-compra-${trimmedCompraId}`,
            }),
          );
          for (const ordenId of uniqueOrdenIds) {
            socket.send(
              buildStompFrame('UNSUBSCRIBE', {
                id: `sub-orden-${ordenId}`,
              }),
            );
          }
          socket.send(buildStompFrame('DISCONNECT', {}));
        }
        socket.close();
      } catch {
        // Ignorar errores al cerrar el socket
      }
      socket = null;
    }
  };
}