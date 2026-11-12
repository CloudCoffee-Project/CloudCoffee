import { decodeSessionToken } from '../utils/jwt';
import {
  buildNotificationsWebSocketUrl,
  buildStompFrame,
  parseStompFrames,
  type StreamConnectionState,
} from './cashierOrders';
import { request } from './httpClient';

export interface Campus {
  id: string;
  nombre: string;
}

export interface Category {
  id: string;
  nombre: string;
}

export interface Product {
  id: string;
  categoriaId: string;
  nombre: string;
  descripcion: string | null;
  imagenUrl: string | null;
  estado: string;
}

export interface ProductDetail {
  id: string;
  nombre: string;
  descripcion: string | null;
  imagenUrl: string | null;
  categoria: Category;
}

export interface ProductOffer {
  id: string;
  cafeteriaId: string;
  cafeteriaName: string;
  price: number;
  stock: number;
  disponible: boolean;
  version?: number;
}

export interface CartItem {
  offerId: string;
  productId: string;
  productName: string;
  cafeteriaId: string;
  cafeteriaName: string;
  price: number;
  quantity: number;
  stock: number;
  version?: number;
}

export interface ProductPage {
  content: Product[];
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

export interface ProductFilters {
  campusId: string;
  categoriaId: string;
  q: string;
  page: number;
}

export const CART_STORAGE_KEY = 'cartItems';
export const CART_UPDATED_EVENT = 'cart:change';

export function getCampus(signal: AbortSignal) {
  return request<Campus[]>('/v1/catalog/campus', { signal, omitAccessToken: true });
}

export function getCategories(signal: AbortSignal) {
  return request<Category[]>('/v1/catalog/categorias', { signal, omitAccessToken: true });
}

export function getProducts(filters: ProductFilters, signal: AbortSignal) {
  const params = new URLSearchParams({
    campusId: filters.campusId,
    page: String(filters.page),
    size: '12',
  });
  if (filters.categoriaId) params.set('categoriaId', filters.categoriaId);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  // Un desempate por ID mantiene el orden al recorrer las páginas.
  params.append('sort', 'name,asc');
  params.append('sort', 'id,asc');
  return request<ProductPage>(`/v1/catalog/productos?${params}`, { signal, omitAccessToken: true });
}

export function getProductById(productId: string, signal: AbortSignal) {
  return request<ProductDetail>(
    `/v1/catalog/productos/${encodeURIComponent(productId)}`,
    { signal, omitAccessToken: true },
  );
}

export function getProductOffers(productId: string, campusId: string, signal: AbortSignal) {
  const params = new URLSearchParams({ campusId });
  return request<ProductOffer[]>(
    `/v1/catalog/productos/${encodeURIComponent(productId)}/ofertas?${params}`,
    { signal, omitAccessToken: true },
  );
}

export function readCartItems(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function addOfferToCart(product: ProductDetail, offer: ProductOffer, quantity = 1): CartItem | null {
  const requested = Math.floor(quantity);
  if (!offer.disponible || offer.stock <= 0 || requested <= 0) {
    return null;
  }

  const items = readCartItems();
  const index = items.findIndex((item) => item.offerId === offer.id);
  const currentQty = index >= 0 ? items[index].quantity : 0;
  const nextQty = Math.min(currentQty + requested, offer.stock);

  const updatedItem: CartItem = {
    offerId: offer.id,
    productId: product.id,
    productName: product.nombre,
    cafeteriaId: offer.cafeteriaId,
    cafeteriaName: offer.cafeteriaName,
    price: Number(offer.price),
    quantity: nextQty,
    stock: offer.stock,
    version: offer.version,
  };
  
  const nextItems = index >= 0
    ? items.map((item, idx) => (idx === index ? updatedItem : item))
    : [...items, updatedItem];

  writeCartItems(nextItems);

  return updatedItem;
}

export function updateCartItemQuantity(offerId: string, quantity: number): CartItem | null {
  const items = readCartItems();
  const item = items.find((cartItem) => cartItem.offerId === offerId);
  if (!item) return null;

  const parsedQuantity = Math.floor(quantity);
  if (!Number.isFinite(parsedQuantity) || parsedQuantity < 1) return null;

  const updatedItem = { ...item, quantity: Math.min(parsedQuantity, item.stock) };
  writeCartItems(items.map((cartItem) => (
    cartItem.offerId === offerId ? updatedItem : cartItem
  )));
  return updatedItem;
}

export function removeCartItem(offerId: string): void {
  const items = readCartItems();
  const nextItems = items.filter((item) => item.offerId !== offerId);
  if (nextItems.length !== items.length) writeCartItems(nextItems);
}

function writeCartItems(items: CartItem[]): void {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  }
}

export interface StockRealtimePayload {
  ofertaId: string;
  productoId?: string;
  cafeteriaId: string;
  campusId?: string;
  stockActual: number;
  version?: number;
}

export interface StockRealtimeEvent {
  eventId: string;
  traceId?: string;
  eventType: string;
  timestamp?: string;
  payload: StockRealtimePayload;
}

export interface CatalogStockStreamOptions {
  cafeteriaIds: string[];
  getAccessToken?: () => string | null;
  onStockEvent: (event: StockRealtimeEvent) => void;
  onReconnect: () => void;
  onConnectionStateChange?: (state: StreamConnectionState) => void;
  reconnectDelayMs?: number;
  webSocketFactory?: (url: string) => WebSocket;
}

export interface OfferStockReconciliationResult {
  offers: ProductOffer[];
  applied: boolean;
  requiresHttpReconciliation: boolean;
}

export function clearCartItems(): void {
  localStorage.removeItem(CART_STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  }
}

export function reconcileCartWithStock(
  ofertaId: string,
  stockActual: number,
  version?: number,
): boolean {
  const items = readCartItems();
  const index = items.findIndex((item) => item.offerId === ofertaId);
  if (index < 0) return false;

  const current = items[index];
  if (
    version !== undefined &&
    current.version !== undefined &&
    version <= current.version
  ) {
    return false;
  }

  const normalizedStock = Math.max(0, Math.floor(stockActual));
  const nextQuantity = normalizedStock > 0
    ? Math.min(current.quantity, normalizedStock)
    : current.quantity;

  const updated: CartItem = {
    ...current,
    stock: normalizedStock,
    quantity: nextQuantity,
    version: version ?? current.version,
  };

  const nextItems = items.map((item, idx) => (idx === index ? updated : item));
  writeCartItems(nextItems);
  return true;
}

export function reconcileCartWithOffers(offers: ProductOffer[]): void {
  if (offers.length === 0) return;
  const items = readCartItems();
  if (items.length === 0) return;

  const offerById = new Map(offers.map((offer) => [offer.id, offer]));
  let changed = false;

  const nextItems = items.map((item) => {
    const offer = offerById.get(item.offerId);
    if (!offer) return item;
    const normalizedStock = offer.disponible ? Math.max(0, offer.stock) : 0;
    const nextQuantity = normalizedStock > 0 ? Math.min(item.quantity, normalizedStock) : item.quantity;
    const nextPrice = Number(offer.price);
    const nextVersion = offer.version ?? item.version;

    if (
      item.stock === normalizedStock &&
      item.quantity === nextQuantity &&
      item.price === nextPrice &&
      item.version === nextVersion
    ) {
      return item;
    }

    changed = true;
    return {
      ...item,
      price: nextPrice,
      stock: normalizedStock,
      quantity: nextQuantity,
      version: nextVersion,
    };
  });

  if (changed) {
    writeCartItems(nextItems);
  }
}

export function applyStockEventToOffers(
  offers: ProductOffer[],
  event: StockRealtimeEvent,
  versionTracker?: Map<string, number>,
): OfferStockReconciliationResult {
  const { ofertaId, stockActual, version } = event.payload;
  const index = offers.findIndex((offer) => offer.id === ofertaId);
  if (index < 0) {
    return { offers, applied: false, requiresHttpReconciliation: false };
  }

  const currentOffer = offers[index];
  const knownVersion = versionTracker?.get(ofertaId) ?? currentOffer.version;

  if (version !== undefined && knownVersion !== undefined) {
    if (version <= knownVersion) {
      return { offers, applied: false, requiresHttpReconciliation: false };
    }
    if (version > knownVersion + 1) {
      versionTracker?.set(ofertaId, version);
      return { offers, applied: false, requiresHttpReconciliation: true };
    }
  }

  if (version !== undefined) {
    versionTracker?.set(ofertaId, version);
  }

  const normalizedStock = Math.max(0, Math.floor(stockActual));
  const updatedOffer: ProductOffer = {
    ...currentOffer,
    stock: normalizedStock,
    disponible: normalizedStock > 0,
    version: version ?? currentOffer.version,
  };

  const nextOffers = offers.map((offer, idx) => (idx === index ? updatedOffer : offer));
  return {
    offers: nextOffers,
    applied: true,
    requiresHttpReconciliation: false,
  };
}

function normalizeStockRealtimeEvent(value: unknown): StockRealtimeEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  if (
    event.eventType !== 'catalog.stock.actualizado.v1' ||
    typeof event.payload !== 'object' ||
    event.payload === null
  ) {
    return null;
  }

  const payload = event.payload as Record<string, unknown>;
  if (
    typeof payload.ofertaId !== 'string' ||
    typeof payload.cafeteriaId !== 'string' ||
    typeof payload.stockActual !== 'number'
  ) {
    return null;
  }

  return {
    eventId: typeof event.eventId === 'string' ? event.eventId : '',
    traceId: typeof event.traceId === 'string' ? event.traceId : undefined,
    eventType: event.eventType,
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
    payload: {
      ofertaId: payload.ofertaId,
      productoId: typeof payload.productoId === 'string' ? payload.productoId : undefined,
      cafeteriaId: payload.cafeteriaId,
      campusId: typeof payload.campusId === 'string' ? payload.campusId : undefined,
      stockActual: payload.stockActual,
      version: typeof payload.version === 'number' ? payload.version : undefined,
    },
  };
}

export function connectCatalogStockStream(options: CatalogStockStreamOptions): () => void {
  const {
    cafeteriaIds,
    getAccessToken = () => localStorage.getItem('accessToken'),
    onStockEvent,
    onReconnect,
    onConnectionStateChange,
    reconnectDelayMs = 3000,
    webSocketFactory = (url: string) => new WebSocket(url),
  } = options;

  const uniqueCafeteriaIds = [...new Set(cafeteriaIds.map((id) => id.trim()).filter(Boolean))];
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

    if (!wsUrl || !token || !validSession || uniqueCafeteriaIds.length === 0) {
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

          for (const cafeteriaId of uniqueCafeteriaIds) {
            socket?.send(
              buildStompFrame('SUBSCRIBE', {
                id: `sub-stock-${cafeteriaId}`,
                destination: `/topic/cafeteria/${cafeteriaId}/stock`,
              }),
            );
          }

          if (shouldReconcile) {
            onReconnect();
          }
        } else if (frame.command === 'MESSAGE' && frame.body) {
          try {
            const parsed: unknown = JSON.parse(frame.body);
            const normalized = normalizeStockRealtimeEvent(parsed);
            if (!normalized) continue;
            if (normalized.eventId) {
              if (seenEventIds.has(normalized.eventId)) continue;
              seenEventIds.add(normalized.eventId);
            }
            onStockEvent(normalized);
          } catch {
            // Ignorar frames con JSON malformado
          }
        } else if (frame.command === 'ERROR') {
          socket?.close();
        }
      }
    };

    socket.onerror = () => {
      // El evento onclose gestionará la reconexión
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
          for (const cafeteriaId of uniqueCafeteriaIds) {
            socket.send(
              buildStompFrame('UNSUBSCRIBE', {
                id: `sub-stock-${cafeteriaId}`,
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