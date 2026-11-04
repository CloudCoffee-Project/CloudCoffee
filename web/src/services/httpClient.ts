import { env } from '../config/env';

export interface ValidationError {
  field: string;
  message: string;
}

export interface GatewayRequestInit extends RequestInit {
  omitAccessToken?: boolean;
}

interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
}

export const AUTH_SESSION_EVENT = 'auth:session-change';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number | null,
    readonly title: string,
    readonly detail: string,
    readonly type: string | null = null,
    readonly instance: string | null = null,
    readonly errors: ValidationError[] = [],
  ) {
    super(detail);
    this.name = 'ApiRequestError';
  }
}

function isValidationError(value: unknown): value is ValidationError {
  return typeof value === 'object' && value !== null &&
    'field' in value && typeof value.field === 'string' &&
    'message' in value && typeof value.message === 'string';
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isRefreshTokenResponse(value: unknown): value is RefreshTokenResponse {
  return typeof value === 'object' && value !== null &&
    'accessToken' in value && typeof value.accessToken === 'string' && value.accessToken.trim().length > 0 &&
    'refreshToken' in value && typeof value.refreshToken === 'string' && value.refreshToken.trim().length > 0;
}

function notifySessionChange(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
  }
}

export function saveSessionTokens(accessToken: string, refreshToken?: string): void {
  localStorage.setItem?.('accessToken', accessToken);
  if (refreshToken) {
    localStorage.setItem?.('refreshToken', refreshToken);
  }
  notifySessionChange();
}

export function clearSessionTokens(): void {
  localStorage.removeItem?.('accessToken');
  localStorage.removeItem?.('refreshToken');
  notifySessionChange();
}

async function responseError(response: Response): Promise<ApiRequestError> {
  const fallback = new ApiRequestError(
    response.status,
    'Error HTTP',
    `La solicitud falló con estado HTTP ${response.status}.`,
  );

  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/problem+json') {
    return fallback;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fallback;
  }

  const problem = body as Record<string, unknown>;
  const errors = Array.isArray(problem.errors)
    ? problem.errors.filter(isValidationError)
    : [];

  return new ApiRequestError(
    response.status,
    stringOrNull(problem.title) ?? fallback.title,
    stringOrNull(problem.detail) ?? fallback.detail,
    stringOrNull(problem.type),
    stringOrNull(problem.instance),
    errors,
  );
}

function gatewayOrigin(baseUrl: string): string {
  if (!baseUrl.trim()) {
    throw new Error('Configura VITE_API_BASE_URL con el origen del API Gateway.');
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('VITE_API_BASE_URL debe ser una URL absoluta del API Gateway.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('VITE_API_BASE_URL debe contener solo el origen HTTP del API Gateway.');
  }

  return url.origin;
}

function gatewayUrl(origin: string, path: string): URL {
  if (!path.startsWith('/v1/')) {
    throw new Error('Las peticiones HTTP deben usar rutas públicas bajo /v1/.');
  }

  const url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/v1/') || url.hash) {
    throw new Error('La ruta debe permanecer dentro de /v1/ del API Gateway.');
  }

  return url;
}

export function createHttpClient(
  baseUrl: string,
  fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init),
) {
  const origin = gatewayOrigin(baseUrl);
  let refreshInFlight: Promise<string | null> | null = null;

  async function executeRefresh(): Promise<string | null> {
    const storedRefreshToken = localStorage.getItem('refreshToken')?.trim();
    if (!storedRefreshToken) {
      clearSessionTokens();
      return null;
    }

    const refreshUrl = gatewayUrl(origin, '/v1/auth/refresh');
    let response: Response;
    try {
      response = await fetcher(refreshUrl, {
        method: 'POST',
        headers: new Headers({
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ refreshToken: storedRefreshToken }),
      });
    } catch {
      return null;
    }

    if (!response.ok) {
      clearSessionTokens();
      return null;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      clearSessionTokens();
      return null;
    }

    if (!isRefreshTokenResponse(payload)) {
      clearSessionTokens();
      return null;
    }

    saveSessionTokens(payload.accessToken, payload.refreshToken);
    return payload.accessToken;
  }

  function refreshAccessToken(): Promise<string | null> {
    if (!refreshInFlight) {
      refreshInFlight = executeRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  async function sendFetch(url: URL, options: RequestInit, headers: Headers): Promise<Response> {
    try {
      return await fetcher(url, { ...options, headers });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      throw new ApiRequestError(
        null,
        'Error de conexión',
        'No se pudo conectar con el API Gateway.',
      );
    }
  }

  return {
    refreshSession: refreshAccessToken,

    async request<T>(path: string, options: GatewayRequestInit = {}): Promise<T> {
      const { omitAccessToken = false, ...fetchOptions } = options;
      const url = gatewayUrl(origin, path);
      const headers = new Headers(fetchOptions.headers);
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }
      const hasCustomAuthHeader = headers.has('Authorization');
      const isAuthRoute = path.startsWith('/v1/auth/login') ||
        path.startsWith('/v1/auth/register') ||
        path.startsWith('/v1/auth/refresh') ||
        path.startsWith('/v1/auth/verificacion');
      const canUseSessionToken = !omitAccessToken && !isAuthRoute && !hasCustomAuthHeader;

      if (canUseSessionToken && refreshInFlight) {
        await refreshInFlight;
      }

      const token = localStorage.getItem('accessToken');
      if (token && canUseSessionToken) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      let response = await sendFetch(url, fetchOptions, headers);

      if (response.status === 401 && canUseSessionToken) {
        const currentStoredToken = localStorage.getItem('accessToken');
        let newAccessToken: string | null = null;

        if (token && currentStoredToken && currentStoredToken !== token) {
          newAccessToken = currentStoredToken;
        } else if (localStorage.getItem('refreshToken')) {
          newAccessToken = await refreshAccessToken();
        } else {
          clearSessionTokens();
        }

        if (newAccessToken) {
          const retryHeaders = new Headers(fetchOptions.headers);
          if (!retryHeaders.has('Accept')) {
            retryHeaders.set('Accept', 'application/json');
          }
          retryHeaders.set('Authorization', `Bearer ${newAccessToken}`);
          response = await sendFetch(url, fetchOptions, retryHeaders);
        }

        if (response.status === 401) {
          clearSessionTokens();
        }
      }

      if (!response.ok) {
        throw await responseError(response);
      }

      if (response.status === 204 || response.status === 205) {
        return undefined as T;
      }

      const body = await response.text();
      if (!body) {
        return undefined as T;
      }

      return response.headers.get('Content-Type')?.includes('json')
        ? JSON.parse(body) as T
        : body as T;
    },
  };
}

let defaultClient: ReturnType<typeof createHttpClient> | undefined;

function getDefaultClient() {
  defaultClient ??= createHttpClient(env.apiBaseUrl);
  return defaultClient;
}

export function request<T>(path: string, options?: GatewayRequestInit): Promise<T> {
  return getDefaultClient().request<T>(path, options);
}

export function refreshSession(): Promise<string | null> {
  return getDefaultClient().refreshSession();
}