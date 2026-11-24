// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { productImageUrl, uploadProductImage } from './productImages';
vi.mock('../config/env', () => ({ env: { apiBaseUrl: 'http://localhost:18080' } }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it('envía multipart con el JWT sin fijar un Content-Type que pierda el boundary', async () => {
  localStorage.setItem('accessToken', 'admin-token');
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'cafe', imagenUrl: '/v1/catalog/imagenes/a.png' }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  const file = new File(['png'], 'cafe.png', { type: 'image/png' }); await uploadProductImage('cafe', file);
  const [url, options] = fetcher.mock.calls[0];
  expect(url.toString()).toBe('http://localhost:18080/v1/catalog/productos/cafe/imagen');
  expect(new Headers(options.headers).get('Authorization')).toBe('Bearer admin-token');
  expect(new Headers(options.headers).has('Content-Type')).toBe(false);
  expect(options.body.get('imagen')).toBe(file);
});
it('resuelve imágenes almacenadas en Gateway y conserva URLs existentes', () => {
  expect(productImageUrl('/v1/catalog/imagenes/a.png')).toBe('http://localhost:18080/v1/catalog/imagenes/a.png');
  expect(productImageUrl('https://example.com/cafe.jpg')).toBe('https://example.com/cafe.jpg');
  expect(productImageUrl(null)).toBeUndefined();
});
