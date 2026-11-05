import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, createHttpClient } from './httpClient';

describe('cliente HTTP del API Gateway', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
    });
  });

  it('usa el origen configurado y conserva la ruta, query y headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: ['café'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createHttpClient('http://localhost:18080/', fetcher);

    const result = await client.request<{ items: string[] }>(
      '/v1/catalog/campus?activo=true',
      { headers: { Authorization: 'Bearer token-de-prueba' } },
    );

    expect(result).toEqual({ items: ['café'] });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(url.toString()).toBe('http://localhost:18080/v1/catalog/campus?activo=true');
    const headers = new Headers(options?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer token-de-prueba');
  });

  it('permite personalizar Accept sin sobrescribirlo', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );
    const client = createHttpClient('https://gateway.example.com', fetcher);

    await expect(client.request('/v1/catalog/campus', {
      headers: { Accept: 'text/plain' },
    })).resolves.toBe('ok');

    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Accept')).toBe('text/plain');
  });

  it('envía el access token almacenado fuera de las rutas de autenticación', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('token-de-sesion'),
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await createHttpClient('http://localhost:18080', fetcher)
      .request('/v1/catalog/campus');

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-de-sesion');
  });

  it('omite el access token almacenado cuando la consulta es pública', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue('token-de-sesion'),
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await createHttpClient('http://localhost:18080', fetcher)
      .request('/v1/catalog/productos', { omitAccessToken: true });

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.has('Authorization')).toBe(false);
  });

  it.each(['/v1/auth/verificacion', '/v1/auth/verificacion/reenviar'])(
    'no adjunta la sesión a la ruta pública %s',
    async (path) => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue('token-de-sesion'),
      });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 202 }),
      );

      await createHttpClient('http://localhost:18080', fetcher)
        .request(path, { method: 'POST', body: '{}' });

      const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
      expect(headers.has('Authorization')).toBe(false);
    },
  );

  it.each(['', '/v1', '/auth/login', 'https://otro.example/v1/auth/login',
    '//otro.example/v1/auth/login', '/v1/../internal', '/v1/%2e%2e/internal',
    '/v1/auth/login#fragmento'])('rechaza la ruta %s antes de enviar', async (path) => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createHttpClient('http://localhost:18080', fetcher);

    await expect(client.request(path)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['', 'gateway.local', 'ftp://gateway.local',
    'http://gateway.local/v1', 'http://gateway.local?token=secreto',
    'http://usuario:clave@gateway.local'])('rechaza el origen inválido %s', (baseUrl) => {
    expect(() => createHttpClient(baseUrl)).toThrow(/VITE_API_BASE_URL/);
  });

  it('convierte Problem Details y conserva los errores de validación', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        type: 'https://cloudcoffee.example/problems/validation',
        title: 'Datos inválidos',
        status: 400,
        detail: 'Revisa el formulario.',
        instance: '/v1/auth/login',
        code: 'PRECIO_CAMBIO',
        compra: { compraId: 'purchase-1', montoTotal: 5200 },
        errors: [{ field: 'email', message: 'Debe ser válido.' }],
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
      }),
    );

    await expect(createHttpClient('http://localhost:18080', fetcher)
      .request('/v1/auth/login', { method: 'POST' }))
      .rejects.toMatchObject({
        name: 'ApiRequestError',
        status: 400,
        type: 'https://cloudcoffee.example/problems/validation',
        title: 'Datos inválidos',
        detail: 'Revisa el formulario.',
        instance: '/v1/auth/login',
        code: 'PRECIO_CAMBIO',
        extensions: { compra: { compraId: 'purchase-1', montoTotal: 5200 } },
        errors: [{ field: 'email', message: 'Debe ser válido.' }],
      });
  });

  it.each([
    ['text/html', '<h1>detalle privado</h1>'],
    ['application/problem+json', '{json inválido'],
    ['application/problem+json', JSON.stringify({ detail: 123, errors: ['no válido'] })],
  ])('usa un error seguro ante una respuesta %s inesperada', async (contentType, body) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, { status: 502, headers: { 'Content-Type': contentType } }),
    );

    await expect(createHttpClient('http://localhost:18080', fetcher)
      .request('/v1/catalog/campus')).rejects.toMatchObject({
        status: 502,
        title: 'Error HTTP',
        detail: 'La solicitud falló con estado HTTP 502.',
        errors: [],
      });
  });

  it('normaliza fallos de red sin mostrar detalles internos', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('host interno:8082'));

    await expect(createHttpClient('http://localhost:18080', fetcher)
      .request('/v1/catalog/campus')).rejects.toEqual(
        new ApiRequestError(null, 'Error de conexión', 'No se pudo conectar con el API Gateway.'),
      );
  });

  it('permite distinguir la cancelación de un fallo de red', async () => {
    const abort = new DOMException('Cancelada', 'AbortError');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(abort);

    await expect(createHttpClient('http://localhost:18080', fetcher)
      .request('/v1/catalog/campus')).rejects.toBe(abort);
  });

  it.each([204, 205])('devuelve undefined si la respuesta %i no tiene contenido', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));

    await expect(createHttpClient('http://localhost:18080', fetcher)
      .request('/v1/auth/login')).resolves.toBeUndefined();
  });
  it('rota el refresh token al recibir 401 y reintenta la solicitud con el nuevo access token', async () => {
    const storage = new Map<string, string>([
      ['accessToken', 'jwt-vencido'],
      ['refreshToken', 'refresh-inicial'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: 'jwt-nuevo',
            refreshToken: 'refresh-rotado',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const client = createHttpClient('http://localhost:18080', fetcher);
    const result = await client.request<{ ok: boolean }>('/v1/orders/mis-compras');

    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][0].toString()).toBe('http://localhost:18080/v1/auth/refresh');
    expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify({ refreshToken: 'refresh-inicial' }));

    const retryHeaders = new Headers(fetcher.mock.calls[2][1]?.headers);
    expect(retryHeaders.get('Authorization')).toBe('Bearer jwt-nuevo');
    expect(storage.get('accessToken')).toBe('jwt-nuevo');
    expect(storage.get('refreshToken')).toBe('refresh-rotado');
  });

  it('evita refresh paralelo y no reutiliza el refresh token rotado en peticiones concurrentes', async () => {
    const storage = new Map<string, string>([
      ['accessToken', 'jwt-vencido'],
      ['refreshToken', 'refresh-unico'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });

    const fetcher = vi.fn<typeof fetch>((input, init) => {
      const url = input.toString();
      const auth = new Headers(init?.headers).get('Authorization');

      if (url.endsWith('/v1/auth/refresh')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'jwt-renovado',
              refreshToken: 'refresh-nuevo',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }

      if (auth === 'Bearer jwt-vencido') {
        return Promise.resolve(new Response(null, { status: 401 }));
      }

      return Promise.resolve(
        new Response(JSON.stringify({ url, auth }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const client = createHttpClient('http://localhost:18080', fetcher);
    const [res1, res2] = await Promise.all([
      client.request<{ auth: string }>('/v1/orders/mis-compras'),
      client.request<{ auth: string }>('/v1/users/me'),
    ]);

    expect(res1.auth).toBe('Bearer jwt-renovado');
    expect(res2.auth).toBe('Bearer jwt-renovado');

    const refreshCalls = fetcher.mock.calls.filter(([url]) =>
      url.toString().endsWith('/v1/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(storage.get('refreshToken')).toBe('refresh-nuevo');
  });

  it('limpia la sesión cuando el refresh token es inválido o expiró', async () => {
    const storage = new Map<string, string>([
      ['accessToken', 'jwt-vencido'],
      ['refreshToken', 'refresh-invalido'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: '/problems/jwt-invalido',
            title: 'No autorizado',
            status: 401,
            detail: 'El token expiró.',
          }),
          { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: '/problems/refresh-token-invalido',
            title: 'Refresh token inválido',
            status: 401,
            detail: 'El refresh token es inválido, expiró o ya fue utilizado.',
          }),
          { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      );

    const client = createHttpClient('http://localhost:18080', fetcher);

    await expect(client.request('/v1/orders/mis-compras')).rejects.toMatchObject({
      status: 401,
    });

    expect(storage.has('accessToken')).toBe(false);
    expect(storage.has('refreshToken')).toBe(false);
  });
});
