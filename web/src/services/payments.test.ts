// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { request } from './httpClient';
import { sandboxCheckoutUrl, startPayment, type Payment } from './payments';

vi.mock('./httpClient', async original => ({
  ...await original<typeof import('./httpClient')>(), request: vi.fn(),
}));

beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); });

it('envía solo el canal web y reutiliza la clave después de perder la respuesta', async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error('Sin conexión'));
  await expect(startPayment('c')).rejects.toThrow('Sin conexión');
  await startPayment('c');
  const calls = vi.mocked(request).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0][0]).toBe('/v1/compras/c/pago');
  expect(calls[0][1]?.body).toBe('{"canalRetorno":"web"}');
  expect(new Headers(calls[0][1]?.headers).get('Idempotency-Key')).toMatch(/^[\da-f-]{36}$/);
});

const payment: Payment = {
  pagoId: 'p', compraId: 'c', estado: 'pendiente', simulado: false,
  proveedor: 'mercadopago_sandbox', entorno: 'sandbox',
  initPoint: 'https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=p',
};

it('acepta enlaces oficiales y no reabre intentos vencidos o pagados', () => {
  expect(sandboxCheckoutUrl(payment)).toBe(payment.initPoint);
  expect(sandboxCheckoutUrl({ ...payment, initPoint: 'https://www.mercadopago.com/checkout' }))
    .toBe('https://www.mercadopago.com/checkout');
  expect(sandboxCheckoutUrl({ ...payment, estado: 'aprobado' })).toBeNull();
  expect(sandboxCheckoutUrl({ ...payment, expiraAt: '2000-01-01T00:00:00Z' })).toBeNull();
});

it.each(['http://mercadopago.cl/checkout', 'https://mercadopago.cl.example.org/checkout'])(
  'rechaza un enlace no válido (%s)', initPoint => {
    expect(() => sandboxCheckoutUrl({ ...payment, initPoint })).toThrow();
  },
);
