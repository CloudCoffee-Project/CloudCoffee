// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { request } from './httpClient';
import { pendingPaymentScenario, startPayment } from './payments';
vi.mock('./httpClient', async original => ({ ...await original<typeof import('./httpClient')>(), request: vi.fn() }));
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });
it('conserva clave y escenario tras timeout, recarga y cambios de selección', async () => {
 await startPayment('c', 'rechazar'); await startPayment('c', 'aprobar'); const calls = vi.mocked(request).mock.calls;
 expect(calls[0]).toEqual(calls[1]); expect(calls[0][0]).toBe('/v1/compras/c/pago'); expect(calls[0][1]?.body).toBe('{"escenario":"rechazar"}'); expect(pendingPaymentScenario('c')).toBe('rechazar');
 expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toMatch(/^[\da-f-]{36}$/);
});
