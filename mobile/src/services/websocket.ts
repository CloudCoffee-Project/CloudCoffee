// src/services/websocket.ts
import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'http://localhost:8081/ws';

let stompClient: Client | null = null;
let pendingSubscriptions: Array<{ topic: string; callback: (message: IMessage) => void }> = [];

export function connectWebSocket(accessToken: string, onConnected?: () => void) {
  stompClient = new Client({
    webSocketFactory: () => new SockJS(WS_URL) as any,
    connectHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
    reconnectDelay: 5000,
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
    debug: (msg) => console.log('[STOMP]', msg),
  });

  stompClient.onConnect = () => {
    console.log('WebSocket conectado');
    // Aplica las suscripciones que quedaron pendientes antes de conectar
    pendingSubscriptions.forEach(({ topic, callback }) => {
      stompClient?.subscribe(topic, callback);
    });
    onConnected?.();
  };

  stompClient.onStompError = (frame) => {
    console.error('Error STOMP:', frame.headers['message'], frame.body);
  };

  stompClient.onWebSocketClose = () => {
    console.log('WebSocket desconectado, reintentando...');
  };

  stompClient.activate();
}

export function disconnectWebSocket() {
  stompClient?.deactivate();
  stompClient = null;
  pendingSubscriptions = [];
}

// Se suscribe a un topic. Si aún no hay conexión, la guarda y la aplica sola al conectar.
// Devuelve una función de limpieza que puedes llamar en el cleanup de tu useEffect.
export function subscribeToTopic(topic: string, callback: (message: IMessage) => void): () => void {
  if (stompClient?.connected) {
    const subscription = stompClient.subscribe(topic, callback);
    return () => subscription.unsubscribe();
  }

  console.warn(`No conectado aún, "${topic}" se suscribirá automáticamente al conectar`);
  const entry = { topic, callback };
  pendingSubscriptions.push(entry);
  return () => {
    pendingSubscriptions = pendingSubscriptions.filter((p) => p !== entry);
  };
}