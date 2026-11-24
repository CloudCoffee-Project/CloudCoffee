import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getReceipt, canDownloadReceipt } from './receipts';
import { ApiRequestError } from './httpClient';
import type { Purchase } from './purchases';
vi.mock('../config/env', () => ({ env: { apiBaseUrl: 'http://localhost:18080' } }));
beforeEach(() => {
  const tokens = new Map([['accessToken', 'jwt-privado']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => tokens.get(key) ?? null,
    setItem: (key: string, value: string) => tokens.set(key, value),
    removeItem: (key: string) => tokens.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
function pdf() { return new Response('%PDF-1.7\nexample', { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="comprobante-CC-orden.pdf"' } }); }
it('descarga bytes y conserva nombre/tipo sin exponer el bearer en URL', async () => {
  const fetcher = vi.fn().mockImplementation(async () => pdf()); vi.stubGlobal('fetch', fetcher);
  const first = await getReceipt('orden'); const second = await getReceipt('orden');
  expect(first.filename).toBe('comprobante-CC-orden.pdf'); expect(second.filename).toBe(first.filename);
  expect(first.blob.type).toBe('application/pdf');
  await expect(first.blob.text()).resolves.toBe('%PDF-1.7\nexample');
  const [url, options] = fetcher.mock.calls[0];
  expect(url.toString()).toBe('http://localhost:18080/v1/orders/orden/boleta');
  expect(new Headers(options.headers).get('Authorization')).toBe('Bearer jwt-privado');
  expect(new Headers(options.headers).get('Accept')).toBe('application/pdf');
  expect(options.responseType).toBeUndefined();
});
it.each([403, 404, 409])('normaliza Problem Details binario con estado %s', async status => {
  const bytes = new TextEncoder().encode(JSON.stringify({ title: 'No disponible', detail: 'No puedes descargar esta orden.', code: 'COMPROBANTE_NO_DISPONIBLE' }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { status, headers: { 'Content-Type': 'application/problem+json' } })));
  await expect(getReceipt('ajena')).rejects.toMatchObject({ status, detail: 'No puedes descargar esta orden.', code: 'COMPROBANTE_NO_DISPONIBLE' });
});
it('renueva el JWT y repite la descarga manteniendo Accept PDF', async () => {
  localStorage.setItem('refreshToken', 'refresh');
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'nuevo', refreshToken: 'rotado' }), { headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(pdf());
  vi.stubGlobal('fetch', fetcher); await getReceipt('orden');
  expect(new Headers(fetcher.mock.calls[2][1].headers).get('Authorization')).toBe('Bearer nuevo');
  expect(new Headers(fetcher.mock.calls[2][1].headers).get('Accept')).toBe('application/pdf');
});
it('rechaza una respuesta HTML exitosa', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } })));
  await expect(getReceipt('orden')).rejects.toBeInstanceOf(ApiRequestError);
});
it('solo ofrece documentos cuando pago, compra y orden están confirmados', () => {
  const purchase = { estado: 'pagado', pago: { estado: 'aprobado' } } as unknown as Purchase;
  const order = { ordenId: 'o', cafeteriaNombre: 'C', montoTotal: 1000, estado: 'pagado' };
  expect(canDownloadReceipt(purchase, order)).toBe(true);
  expect(canDownloadReceipt(purchase, { ...order, estado: 'pendiente_pago' })).toBe(false);
  expect(canDownloadReceipt({ ...purchase, pago: { estado: 'pendiente' } }, order)).toBe(false);
});
