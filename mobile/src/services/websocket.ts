// src/services/websocket.ts
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

import { WS_BASE_URL } from '../config/api';

// Topics STOMP del dominio de pedidos y stock (notification-service).
export const topicOrdenEstado = (ordenId: string): string => `/topic/orden/${ordenId}/estado`;

export const topicCafeteriaStock = (cafeteriaId: string): string =>
  `/topic/cafeteria/${cafeteriaId}/stock`;

// Estado de la conexión expuesto vía callback. La librería no imprime nada
// por consola: quien la consuma decide cómo reflejar conectado/error.
export interface EstadoWebSocket {
  conectado: boolean;
  error?: string;
}

// Un token fijo sirve para tests; el proveedor se usa en la app para leer el
// accessToken vigente en cada reconnect (el refresh puede rotarlo).
export type TokenWebSocket = string | (() => string | null | undefined);

interface Suscripcion {
  topic: string;
  callback: (message: IMessage) => void;
  activa: StompSubscription | null;
}

let stompClient: Client | null = null;
let suscripciones: Suscripcion[] = [];

function tokenActual(token: TokenWebSocket): string | null | undefined {
  return typeof token === 'function' ? token() : token;
}

function headersDeConexion(token: TokenWebSocket): { Authorization?: string } {
  const valor = tokenActual(token);
  return valor ? { Authorization: `Bearer ${valor}` } : {};
}

function desactivarCliente(cliente: Client | null): void {
  if (!cliente) return;

  // Se limpian los callbacks antes de deactivate(): el cierre intencional no
  // debe notificar "desconectado" ni disparar una reconexión desde el cleanup.
  cliente.onConnect = () => {};
  cliente.onStompError = () => {};
  cliente.onWebSocketClose = () => {};

  try {
    void Promise.resolve(cliente.deactivate()).catch(() => {
      // Ya nos desconectamos localmente: no hay nada que reintentar acá.
    });
  } catch {
    // Igual que arriba: el cleanup nunca debe lanzar hacia la pantalla.
  }
}

export function connectWebSocket(
  accessToken: TokenWebSocket,
  onEstado?: (estado: EstadoWebSocket) => void
): void {
  desactivarCliente(stompClient);
  stompClient = null;

  if (!tokenActual(accessToken)) {
    onEstado?.({ conectado: false, error: 'No hay token de acceso para el WebSocket' });
    return;
  }

  const client = new Client({
    webSocketFactory: () => new SockJS(WS_BASE_URL),
    connectHeaders: headersDeConexion(accessToken),
    // @stomp/stompjs reintenta automáticamente cada reconnectDelay. Antes de
    // cada intento se vuelve a leer el token: si el refresh rotó el
    // accessToken, el reconnect usa el nuevo sin depender de un re-render.
    beforeConnect: (conectando) => {
      conectando.connectHeaders = headersDeConexion(accessToken);
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
  });

  stompClient = client;

  client.onConnect = () => {
    // onConnect se llama también después de cada reconnect. Se resuscriben
    // TODAS las suscripciones vigentes (no solo las pendientes del primer
    // connect) porque STOMP pierde los subscriptions al caer la conexión.
    suscripciones.forEach((entrada) => {
      entrada.activa = client.subscribe(entrada.topic, entrada.callback);
    });
    onEstado?.({ conectado: true });
  };

  client.onStompError = (frame) => {
    onEstado?.({
      conectado: false,
      error: frame.headers['message'] ?? frame.body,
    });
  };

  client.onWebSocketClose = () => {
    // No reconectamos a mano: reconnectDelay ya agenda el nuevo intento y
    // onConnect volverá a aplicar las suscripciones.
    onEstado?.({ conectado: false });
  };

  client.activate();
}

export function disconnectWebSocket(): void {
  desactivarCliente(stompClient);
  stompClient = null;
  suscripciones.forEach((entrada) => {
    entrada.activa = null;
  });
  suscripciones = [];
}

// Registra el topic como "deseado" para que sobreviva a reconexiones y
// devuelve una función de limpieza para el cleanup del useEffect (salir de la
// pantalla o cerrar sesión).
export function subscribeToTopic(topic: string, callback: (message: IMessage) => void): () => void {
  const entrada: Suscripcion = { topic, callback, activa: null };
  suscripciones.push(entrada);

  if (stompClient?.connected) {
    entrada.activa = stompClient.subscribe(topic, callback);
  }

  return () => {
    suscripciones = suscripciones.filter((s) => s !== entrada);
    entrada.activa?.unsubscribe();
    entrada.activa = null;
  };
}
