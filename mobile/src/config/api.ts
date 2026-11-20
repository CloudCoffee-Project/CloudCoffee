// src/config/api.ts
//
// Configuración central de la URL del API Gateway. Todo el tráfico HTTP de la
// app pasa por el gateway (INT4-16), nunca directo a un microservicio.

import { Platform } from 'react-native';

// Puerto publicado del api-gateway en docker-compose (ver .env del backend,
// variable API_GATEWAY_PORT). Se usa solo como fallback local cuando no hay
// EXPO_PUBLIC_API_URL.
const GATEWAY_PORT = 18080;

function defaultHost(): string {
  // El emulador de Android no ve "localhost" del host, usa 10.0.2.2.
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

const GATEWAY_URL = `http://${defaultHost()}:${GATEWAY_PORT}`;

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? GATEWAY_URL;

// Endpoint STOMP sobre SockJS del notification-service, expuesto por el
// Gateway. El JWT viaja en el frame CONNECT, nunca en la URL.
const WS_PATH = '/v1/notifications/ws';

function conPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

export const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_URL ?? conPath(API_BASE_URL, WS_PATH);

export const DEFAULT_TIMEOUT_MS = 10_000;
