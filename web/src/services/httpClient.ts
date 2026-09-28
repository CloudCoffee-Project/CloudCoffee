import { env } from '../config/env';

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

      const response = await fetcher(url, { ...options, headers });
      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status}`);
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
