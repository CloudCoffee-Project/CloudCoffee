// src/services/httpClient.ts
//
// Capa HTTP base (INT4-16) sobre axios. Proporciona:
//   - Una instancia única de axios apuntando al API Gateway.
//   - setAccessToken() para que el flujo de login (INT2-21) inyecte el JWT.
//   - Normalización de errores: los microservicios responden con RFC 9457
//     (problem+json), ver common-errors en el backend.

import { create } from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { API_BASE_URL } from '../config/api';

export const DEFAULT_TIMEOUT_MS = 10_000;

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

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
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

httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiProblem>) => Promise.reject(toApiError(error))
);
