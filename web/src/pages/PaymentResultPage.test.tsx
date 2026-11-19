// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PaymentResultPage } from './PaymentResultPage';
import { PaymentCheckout } from '../components/PaymentCheckout';
import { getPayment, openMercadoPagoCheckout, startPayment, type Payment } from '../services/payments';
import { getPurchase } from '../services/purchases';
import { ApiRequestError } from '../services/httpClient';

vi.mock('../config/env', () => ({ env: { apiBaseUrl: 'http://localhost:18080' } }));
vi.mock('../services/payments', async original => ({
  ...await original<typeof import('../services/payments')>(),
  getPayment: vi.fn(),
  startPayment: vi.fn(),
  openMercadoPagoCheckout: vi.fn(),
}));
vi.mock('../services/purchases', async original => ({
  ...await original<typeof import('../services/purchases')>(),
  getPurchase: vi.fn(),
  connectPurchaseRealtimeStream: () => () => {},
}));

const payment: Payment = {
  pagoId: 'p', compraId: 'c', estado: 'pendiente', simulado: false,
  proveedor: 'mercadopago_sandbox', entorno: 'sandbox',
  initPoint: 'https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=p',
};
const purchase = { compraId: 'c', estado: 'pendiente_pago', montoTotal: 2500, moneda: 'CLP', ordenes: [], reservaExpiraAt: '', pago: null };
const notStarted = new ApiRequestError(404, 'Sin pago', 'Pago aún no iniciado', null, null, [], 'PAGO_NO_ENCONTRADO');
const reconciling = new ApiRequestError(503, 'En conciliación', 'Reconsulta el pago', null, null, [], 'PAGO_EN_CONCILIACION');

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(getPurchase).mockResolvedValue(purchase);
  vi.mocked(getPayment).mockResolvedValue(payment);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function result() {
  return render(
    <MemoryRouter initialEntries={['/pago/retorno?compraId=c&status=approved&resultado=exito']}>
      <PaymentResultPage />
    </MemoryRouter>,
  );
}

function checkout() {
  return render(<MemoryRouter><Routes>
    <Route path="/" element={<PaymentCheckout compraId="c" />} />
    <Route path="/pago/resultado" element={<p>Resultado desde servidor</p>} />
  </Routes></MemoryRouter>);
}

function pay() {
  fireEvent.click(screen.getByRole('button', { name: 'Pagar con Mercado Pago' }));
}

it('ignora el resultado de la URL de retorno y muestra el pago pendiente de Order', async () => {
  result();
  expect(await screen.findByText('Pago pendiente de confirmación')).toBeTruthy();
  expect(screen.queryByText('Pago aprobado')).toBeNull();
  expect(startPayment).not.toHaveBeenCalled();
});

it('consulta hasta recibir el resultado aun con la preferencia en conciliación', async () => {
  vi.useFakeTimers();
  vi.mocked(getPayment).mockRejectedValueOnce(reconciling).mockResolvedValueOnce({ ...payment, estado: 'aprobado' });
  await act(async () => { result(); });
  expect(screen.getByText('Pago en conciliación')).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Pago aprobado')).toBeTruthy();
  expect(startPayment).not.toHaveBeenCalled();
});

it('rechaza una respuesta de otro proveedor', async () => {
  vi.mocked(getPayment).mockResolvedValue({ ...payment, simulado: true, proveedor: 'simulado', estado: 'aprobado' });
  result();
  expect((await screen.findByRole('alert')).textContent).toMatch(/no devolvió un pago de Mercado Pago Sandbox/);
  expect(screen.queryByText('Pago aprobado')).toBeNull();
});

it.each([401, 404])('no expone datos cuando Order rechaza acceso a la compra (%s)', async status => {
  vi.mocked(getPurchase).mockRejectedValue(new ApiRequestError(status, 'No encontrada', 'Compra no encontrada'));
  result();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Compra no encontrada');
  expect(getPayment).not.toHaveBeenCalled();
});

it('inicia el pago cuando Order informa que aún no existe y abre el checkout', async () => {
  vi.mocked(getPayment).mockRejectedValue(notStarted);
  vi.mocked(startPayment).mockResolvedValue(payment);
  checkout();
  pay();
  await waitFor(() => expect(openMercadoPagoCheckout).toHaveBeenCalledWith(payment.initPoint));
  expect(startPayment).toHaveBeenCalledExactlyOnceWith('c', expect.any(AbortSignal));
});

it('reabre un checkout vigente sin volver a crearlo', async () => {
  checkout();
  pay();
  await waitFor(() => expect(openMercadoPagoCheckout).toHaveBeenCalledWith(payment.initPoint));
  expect(startPayment).not.toHaveBeenCalled();
});

it('va al resultado si el pago ya está aprobado', async () => {
  vi.mocked(getPayment).mockResolvedValue({ ...payment, estado: 'aprobado' });
  checkout();
  pay();
  expect(await screen.findByText('Resultado desde servidor')).toBeTruthy();
  expect(openMercadoPagoCheckout).not.toHaveBeenCalled();
  expect(startPayment).not.toHaveBeenCalled();
});

it('no vuelve a crear el pago si el inicio quedó en conciliación', async () => {
  vi.mocked(getPayment).mockRejectedValueOnce(notStarted);
  vi.mocked(startPayment).mockRejectedValueOnce(reconciling);
  checkout();
  pay();
  expect(await screen.findByText('Resultado desde servidor')).toBeTruthy();
  expect(startPayment).toHaveBeenCalledTimes(1);
  expect(openMercadoPagoCheckout).not.toHaveBeenCalled();
});

it('permite reintentar tras un error de red consultando primero a Order', async () => {
  vi.mocked(getPayment).mockRejectedValueOnce(notStarted);
  vi.mocked(startPayment).mockRejectedValueOnce(new Error('Sin conexión'));
  checkout();
  pay();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Sin conexión');
  pay();
  await waitFor(() => expect(openMercadoPagoCheckout).toHaveBeenCalledWith(payment.initPoint));
  expect(getPayment).toHaveBeenCalledTimes(2);
  expect(startPayment).toHaveBeenCalledTimes(1);
});
