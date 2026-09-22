// src/services/httpClient.ts
//
// Capa HTTP base (INT4-16) sobre axios. Proporciona:
//   - Una instancia única de axios apuntando al API Gateway.
//   - setAccessToken()/setTokens() para inyectar los tokens (INT2-21).
//   - Normalización de errores: los microservicios responden con RFC 9457
//     (problem+json), ver common-errors en el backend.
//
// Interceptor de refresh (INT4-17):
//   - Agrega el JWT a cada petición (Authorization: Bearer <accessToken>).
//   - Ante un 401 con refreshToken presente, renueva el accessToken vía
//     /v1/auth/refresh (authRefresh) y reintenta la petición original.
//   - Las peticiones fallidas en paralelo comparten un único refresh
//     (cola single-flight) para no disparar refreshes redundantes.

import { create } from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { API_BASE_URL, DEFAULT_TIMEOUT_MS } from '../config/api';
import { requestNewTokens } from './authRefresh';

// Cuerpo estándar de error RFC 9457 usado por el backend.
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  timestamp?: string;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setRefreshToken(token: string | null): void {
  refreshToken = token;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

// Fija el par de tokens completo (usado por el flujo de login/refresh).
export function setTokens(tokens: { accessToken: string; refreshToken?: string }): void {
  accessToken = tokens.accessToken;
  if (tokens.refreshToken !== undefined) {
    refreshToken = tokens.refreshToken;
  }
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
}

export const httpClient = create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

httpClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  } else {
    config.headers.delete('Authorization');
  }
  return config;
});

export class ApiError extends Error {
  readonly status: number;
  readonly problem?: ApiProblem;

  constructor(message: string, status: number, problem?: ApiProblem) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export function toApiError(error: AxiosError<ApiProblem>): ApiError {
  // Sin respuesta (red caída, timeout, DNS): no hay problem+json que mostrar.
  if (!error.response) {
    return new ApiError(error.message, 0);
  }

  const { status, data } = error.response;
  const detail = data?.detail ?? error.message;
  return new ApiError(detail, status, data);
}

// Decodifica la parte payload de un JWT (base64url) y devuelve su exp en
// segundos (epoch). Devuelve null si el token no tiene exp o es inválido.
export function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) {
      return null;
    }

    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: unknown };

    return typeof decoded.exp === 'number' ? decoded.exp : null;
  } catch {
    return null;
  }
}

// true si el token ya expiró (comparando contra nowSeconds, por defecto ahora).
export function isAccessTokenExpired(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const exp = decodeJwtExp(token);
  return exp !== null && exp <= nowSeconds;
}

// Cola single-flight del refresh: mientras una renovación está en curso, las
// demás llamadas esperan la misma promesa.
let refreshInFlight: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) {
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = requestNewTokens(refreshToken)
      .then((tokens) => {
        if (tokens.accessToken) {
          accessToken = tokens.accessToken;
        }
        if (tokens.refreshToken) {
          refreshToken = tokens.refreshToken;
        }
        return accessToken;
      })
      .catch(() => {
        clearTokens();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiProblem>) => {
    const { config, response } = error;

    // Sin red o sin config (timeout, DNS): rechazar tal cual.
    if (!config || !response) {
      return Promise.reject(toApiError(error));
    }

    const retryable = config as RetryableConfig;
    const isUnauthorized = response.status === 401;
    const canRetry = isUnauthorized && !retryable._retried && refreshToken !== null;

    if (!canRetry) {
      return Promise.reject(toApiError(error));
    }

    retryable._retried = true;

    const newAccessToken = await refreshAccessToken();
    if (!newAccessToken) {
      return Promise.reject(toApiError(error));
    }

    retryable.headers.set('Authorization', `Bearer ${newAccessToken}`);
    return httpClient(retryable);
  }
);
