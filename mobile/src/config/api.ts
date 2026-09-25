// src/config/api.ts
//
// Configuración central de la URL del API Gateway. Todo el tráfico HTTP de la
// app pasa por el gateway (INT4-16), nunca directo a un microservicio.

import { Platform } from 'react-native';

// Puerto publicado del api-gateway en docker-compose (ver .env del backend,
// variable API_GATEWAY_PORT).
const GATEWAY_PORT = 18080;

function defaultHost(): string {
  // El emulador de Android no ve "localhost" del host, usa 10.0.2.2.
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

const GATEWAY_URL = `http://${defaultHost()}:${GATEWAY_PORT}`;

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? GATEWAY_URL;

// Endpoint STOMP/WebSocket, mismo host/patrón Platform-aware que el gateway
// HTTP. El backend todavía no expone /ws: se centraliza acá para que el
// contrato se fije en un solo lugar cuando exista.
const WS_PATH = '/ws';

const GATEWAY_WS_URL = `http://${defaultHost()}:${GATEWAY_PORT}${WS_PATH}`;

export const WS_BASE_URL = process.env.EXPO_PUBLIC_WS_URL ?? GATEWAY_WS_URL;

export const DEFAULT_TIMEOUT_MS = 10_000;
