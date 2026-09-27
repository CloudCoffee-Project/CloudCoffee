// src/services/websocket.ts
import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

import { WS_BASE_URL } from '../config/api';

// Topics STOMP del dominio de pedidos y stock. El backend todavía no expone
// un endpoint STOMP; se centralizan acá para fijar el contrato en un solo
// lugar cuando exista (ver config/api.ts → WS_BASE_URL).
export const topicOrdenEstado = (ordenId: string): string => `/topic/orden/${ordenId}/estado`;

export const topicCafeteriaStock = (cafeteriaId: string): string =>
  `/topic/cafeteria/${cafeteriaId}/stock`;

// Estado de la conexión expuesto vía callback. La librería no imprime nada
// por consola: quien la consuma decide cómo reflejar conectado/error.
export interface EstadoWebSocket {
  conectado: boolean;
  error?: string;
}

let stompClient: Client | null = null;
let pendingSubscriptions: { topic: string; callback: (message: IMessage) => void }[] = [];

export function connectWebSocket(
  accessToken: string,
  onEstado?: (estado: EstadoWebSocket) => void
): void {
  stompClient = new Client({
    webSocketFactory: () => new SockJS(WS_BASE_URL),
    connectHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
  });

  stompClient.onConnect = () => {
    // Aplica las suscripciones que quedaron pendientes antes de conectar.
    pendingSubscriptions.forEach(({ topic, callback }) => {
      stompClient?.subscribe(topic, callback);
    });
    onEstado?.({ conectado: true });
  };

  stompClient.onStompError = (frame) => {
    onEstado?.({
      conectado: false,
      error: frame.headers['message'] ?? frame.body,
    });
  };

  stompClient.onWebSocketClose = () => {
    onEstado?.({ conectado: false });
  };

  stompClient.activate();
}

export function disconnectWebSocket(): void {
  stompClient?.deactivate();
  stompClient = null;
  pendingSubscriptions = [];
}

// Se suscribe a un topic. Si aún no hay conexión, la guarda y la aplica sola
// al conectar. Devuelve una función de limpieza para el cleanup del useEffect.
export function subscribeToTopic(topic: string, callback: (message: IMessage) => void): () => void {
  if (stompClient?.connected) {
    const subscription = stompClient.subscribe(topic, callback);
    return () => subscription.unsubscribe();
  }

  const entry = { topic, callback };
  pendingSubscriptions.push(entry);
  return () => {
    pendingSubscriptions = pendingSubscriptions.filter((p) => p !== entry);
  };
}
