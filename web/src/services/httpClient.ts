import { env } from '../config/env';

export interface ValidationError {
  field: string;
  message: string;
}

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

export function createHttpClient(baseUrl: string, fetcher: typeof fetch = fetch) {
  const origin = gatewayOrigin(baseUrl);

  return {
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const url = gatewayUrl(origin, path);
      const headers = new Headers(options.headers);
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }
      const token = localStorage.getItem('accessToken');
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      let response: Response;
      try {
        response = await fetcher(url, { ...options, headers });
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

export function request<T>(path: string, options?: RequestInit): Promise<T> {
  defaultClient ??= createHttpClient(env.apiBaseUrl);
  return defaultClient.request<T>(path, options);
}
