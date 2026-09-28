import { describe, expect, it, vi } from 'vitest';
import { createHttpClient } from './httpClient';

describe('cliente HTTP del API Gateway', () => {
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
});
