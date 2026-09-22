// src/services/authRefresh.ts
//
// Cliente aislado para renovar el accessToken vía POST /v1/auth/refresh.
// Se mantiene separado del httpClient para no pasar por los interceptores
// (evita recursión al reintentar una petición 401).
//
// Contrato esperado del backend (INT2-21, aún pendiente de merge):
//   POST /v1/auth/refresh  Body: { "refreshToken": "..." }
//   Response: { "accessToken": "...", "refreshToken": "..." }

import { create } from 'axios';

import { API_BASE_URL, DEFAULT_TIMEOUT_MS } from '../config/api';

export interface RefreshTokensResponse {
  accessToken?: string;
  refreshToken?: string;
}

export const REFRESH_ENDPOINT = '/v1/auth/refresh';

const authRefreshClient = create({
  baseURL: API_BASE_URL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

export async function requestNewTokens(refreshToken: string): Promise<RefreshTokensResponse> {
  const response = await authRefreshClient.post<RefreshTokensResponse>(REFRESH_ENDPOINT, {
    refreshToken,
  });
  return response.data;
}
