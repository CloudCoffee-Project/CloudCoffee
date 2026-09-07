// src/services/websocket.ts
import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

// URL configurable vía variable de entorno (ver .env). Fallback solo para desarrollo local.
const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'http://localhost:8081/ws';

let stompClient: Client | null = null;

export function connectWebSocket(accessToken: string, onConnected?: () => void) {
  stompClient = new Client({
    webSocketFactory: () => new SockJS(WS_URL) as any,
    connectHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
    reconnectDelay: 5000, // reintenta cada 5 segundos si se cae
    heartbeatIncoming: 4000,
    heartbeatOutgoing: 4000,
    debug: (msg) => console.log('[STOMP]', msg),
  });

  stompClient.onConnect = () => {
    console.log('WebSocket conectado');
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
}

export function subscribeToTopic(topic: string, callback: (message: IMessage) => void) {
  if (!stompClient?.connected) {
    console.warn('No conectado aún, no se puede suscribir a', topic);
    return;
  }
  return stompClient.subscribe(topic, callback);
}