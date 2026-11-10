import { env } from '../config/env';
import { request } from './httpClient';

export type OrderStatus =
  | 'revision_requerida'
  | 'pendiente_pago'
  | 'pagado'
  | 'listo_para_retiro'
  | 'entregado'
  | 'no_retirado_pendiente_revision'
  | 'no_retirado_final'
  | 'cancelado';

export interface CashierOrderItem {
  ordenItemId: string;
  ofertaId: string;
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface CashierOrder {
  ordenId: string;
  compraId: string;
  codigoOrden: string;
  cafeteriaId: string;
  cafeteriaNombre: string;
  estado: OrderStatus | string;
  montoTotal: number;
  moneda: string;
  items: CashierOrderItem[];
  reservaExpiraAt: string | null;
  retiroHasta: string | null;
  entregadoAt: string | null;
  creadoAt: string;
  actualizadoAt: string;
  version: number;
}

export interface CashierOrderPage {
  content: CashierOrder[];
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  empty: boolean;
}

export interface CashierOrderFilters {
  page?: number;
  size?: number;
  estado?: string;
  codigoOrden?: string;
}

export interface OrderRealtimePayload {
  ordenId: string;
  compraId?: string;
  clienteId?: string;
  cafeteriaId: string;
  estadoAnterior?: OrderStatus | string | null;
  estado: OrderStatus | string;
  entregadoAt?: string | null;
  version?: number;
}

export interface OrderRealtimeEvent {
  eventId: string;
  traceId?: string;
  eventType: string;
  timestamp?: string;
  occurredAt?: string;
  payload: OrderRealtimePayload;
}

export type StreamConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface CashierOrdersStreamOptions {
  cafeteriaId: string;
  getAccessToken?: () => string | null;
  onEvent: (event: OrderRealtimeEvent) => void;
  onReconnect: () => void;
  onConnectionStateChange?: (state: StreamConnectionState) => void;
  reconnectDelayMs?: number;
  webSocketFactory?: (url: string) => WebSocket;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  revision_requerida: 'Revisión requerida',
  pendiente_pago: 'Pendiente de pago',
  pagado: 'Pagado',
  listo_para_retiro: 'Listo para retiro',
  entregado: 'Entregado',
  no_retirado_pendiente_revision: 'No retirado (en revisión)',
  no_retirado_final: 'No retirado (final)',
  cancelado: 'Cancelado',
};

export function formatOrderStatus(estado: string): string {
  if (estado in ORDER_STATUS_LABELS) {
    return ORDER_STATUS_LABELS[estado as OrderStatus];
  }
  return estado;
}

export async function getCashierOrders(
  filters: CashierOrderFilters = {},
  signal?: AbortSignal,
): Promise<CashierOrderPage> {
  const params = new URLSearchParams();
  params.set('page', String(filters.page ?? 0));
  params.set('size', String(filters.size ?? 20));

  const trimmedEstado = filters.estado?.trim();
  if (trimmedEstado) {
    params.set('estado', trimmedEstado);
  }

  const trimmedCodigo = filters.codigoOrden?.trim();
  if (trimmedCodigo) {
    params.set('codigoOrden', trimmedCodigo);
  }

  return request<CashierOrderPage>(`/v1/orders?${params.toString()}`, {
    method: 'GET',
    signal,
  });
}

export function buildNotificationsWebSocketUrl(baseUrl: string = env.apiBaseUrl): string | null {
  if (!baseUrl.trim()) {
    return null;
  }

  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${url.host}/v1/notifications/ws/websocket`;
  } catch {
    return null;
  }
}

function buildStompFrame(command: string, headers: Record<string, string>, body = ''): string {
  const headerLines = Object.entries(headers).map(([key, value]) => `${key}:${value}`);
  return `${command}\n${headerLines.join('\n')}\n\n${body}\0`;
}

function parseStompFrames(rawData: string): Array<{ command: string; headers: Record<string, string>; body: string }> {
  return rawData
    .split('\0')
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.length > 0)
    .map((frameText) => {
      const separatorIndex = frameText.indexOf('\n\n');
      const headerSection = separatorIndex >= 0 ? frameText.slice(0, separatorIndex) : frameText;
      const body = separatorIndex >= 0 ? frameText.slice(separatorIndex + 2) : '';
      const lines = headerSection.split('\n');
      const command = (lines[0] ?? '').trim();
      const headers: Record<string, string> = {};

      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.slice(0, colonIndex).trim();
          const value = line.slice(colonIndex + 1).trim();
          headers[key] = value;
        }
      }

      return { command, headers, body };
    });
}

function normalizeRealtimeEvent(value: unknown): OrderRealtimeEvent | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const event = value as Record<string, unknown>;
  if (typeof event.eventType !== 'string' || typeof event.payload !== 'object' || event.payload === null) {
    return null;
  }
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.ordenId !== 'string') {
    return null;
  }
  const resolvedEstado =
    typeof payload.estado === 'string'
      ? payload.estado
      : event.eventType === 'order.orden.entregada.v1'
        ? 'entregado'
        : null;

  if (!resolvedEstado) {
    return null;
  }

  return {
    eventId: typeof event.eventId === 'string' ? event.eventId : '',
    traceId: typeof event.traceId === 'string' ? event.traceId : undefined,
    eventType: event.eventType,
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
    occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt : undefined,
    payload: {
      ordenId: payload.ordenId,
      compraId: typeof payload.compraId === 'string' ? payload.compraId : undefined,
      clienteId: typeof payload.clienteId === 'string' ? payload.clienteId : undefined,
      cafeteriaId: typeof payload.cafeteriaId === 'string' ? payload.cafeteriaId : '',
      estadoAnterior:
        typeof payload.estadoAnterior === 'string' || payload.estadoAnterior === null
          ? payload.estadoAnterior
          : undefined,
      estado: resolvedEstado,
      entregadoAt:
        typeof payload.entregadoAt === 'string' || payload.entregadoAt === null
          ? payload.entregadoAt
          : undefined,
      version: typeof payload.version === 'number' ? payload.version : undefined,
    },
  };
}

export function connectCashierOrdersStream(options: CashierOrdersStreamOptions): () => void {
  const {
    cafeteriaId,
    getAccessToken = () => localStorage.getItem('accessToken'),
    onEvent,
    onReconnect,
    onConnectionStateChange,
    reconnectDelayMs = 3000,
    webSocketFactory = (url: string) => new WebSocket(url),
  } = options;

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
    if (disposed || reconnectTimer !== null) {
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
    if (disposed) {
      return;
    }

    const wsUrl = buildNotificationsWebSocketUrl();
    const token = getAccessToken()?.trim();

    if (!wsUrl || !token || !cafeteriaId.trim()) {
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
      if (disposed || !socket) {
        return;
      }
      const connectFrame = buildStompFrame('CONNECT', {
        'accept-version': '1.2',
        Authorization: `Bearer ${token}`,
      });
      socket.send(connectFrame);
    };

    socket.onmessage = (messageEvent: MessageEvent) => {
      if (disposed || typeof messageEvent.data !== 'string') {
        return;
      }

      const frames = parseStompFrames(messageEvent.data);
      for (const frame of frames) {
        if (frame.command === 'CONNECTED') {
          const shouldReconcile = hasConnectedOnce || reconnecting;
          hasConnectedOnce = true;
          reconnecting = false;
          updateState('connected');

          socket?.send(
            buildStompFrame('SUBSCRIBE', {
              id: `sub-cafeteria-${cafeteriaId}`,
              destination: `/topic/cafeteria/${cafeteriaId}/ordenes`,
            }),
          );

          if (shouldReconcile) {
            onReconnect();
          }
        } else if (frame.command === 'MESSAGE' && frame.body) {
          try {
            const parsed: unknown = JSON.parse(frame.body);
            const normalized = normalizeRealtimeEvent(parsed);
            if (normalized) {
              if (normalized.eventId) {
                if (seenEventIds.has(normalized.eventId)) {
                  continue;
                }
                seenEventIds.add(normalized.eventId);
              }
              onEvent(normalized);
            }
          } catch {
            // Ignorar frames con JSON malformado
          }
        } else if (frame.command === 'ERROR') {
          socket?.close();
        }
      }
    };

    socket.onerror = () => {
      // El evento onclose posterior gestionará la reconexión
    };

    socket.onclose = () => {
      socket = null;
      if (!disposed) {
        scheduleReconnect();
      }
    };
  };

  const handleWindowOnline = () => {
    if (disposed) {
      return;
    }
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
          socket.send(buildStompFrame('DISCONNECT', {}));
        }
        socket.close();
      } catch {
        // Ignorar errores al cerrar el socket durante el desmontaje
      }
      socket = null;
    }
  };
}