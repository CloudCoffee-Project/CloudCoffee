// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PaymentResultPage } from './PaymentResultPage';
import { PaymentCheckout } from '../components/PaymentCheckout';
import { getPayment, startPayment, type Payment } from '../services/payments';
import { getPurchase } from '../services/purchases';
import { ApiRequestError } from '../services/httpClient';
vi.mock('../config/env', () => ({ env: { apiBaseUrl: 'http://localhost:18080' } }));
vi.mock('../services/payments', async original => ({ ...await original<typeof import('../services/payments')>(), getPayment: vi.fn(), startPayment: vi.fn() }));
vi.mock('../services/purchases', async original => ({ ...await original<typeof import('../services/purchases')>(), getPurchase: vi.fn(), connectPurchaseRealtimeStream: () => () => {} }));
const payment: Payment = { pagoId: 'p', compraId: 'c', estado: 'pendiente', simulado: true, proveedor: 'simulado' };
const purchase = { compraId: 'c', estado: 'pendiente_pago', montoTotal: 2500, moneda: 'CLP', ordenes: [], reservaExpiraAt: '', pago: null };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear(); vi.mocked(getPurchase).mockResolvedValue(purchase); vi.mocked(getPayment).mockResolvedValue(payment); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
function result() { return render(<MemoryRouter initialEntries={['/pago/resultado?compraId=c&status=approved']}><PaymentResultPage /></MemoryRouter>); }
function checkout() { return render(<MemoryRouter><Routes><Route path="/" element={<PaymentCheckout compraId="c" />} /><Route path="/pago/resultado" element={<p>Resultado desde servidor</p>} /></Routes></MemoryRouter>); }
it('ignora aprobación en URL y muestra estado del servidor', async () => {
 result(); expect(await screen.findByText('Pago pendiente de confirmación')).toBeTruthy(); expect(screen.queryByText('Pago aprobado')).toBeNull();
});
it('consulta el estado sin depender del WebSocket', async () => {
 vi.useFakeTimers(); vi.mocked(getPayment).mockResolvedValueOnce(payment).mockResolvedValueOnce({ ...payment, estado: 'aprobado' });
 await act(async () => { result(); }); await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(screen.getByText('Pago aprobado')).toBeTruthy();
});
it('rechaza configuración de proveedor externo', async () => {
 vi.mocked(getPayment).mockResolvedValue({ ...payment, simulado: false, proveedor: 'mercadopago_sandbox', estado: 'aprobado' });
 result(); expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'El servidor no está configurado para pago simulado.'); expect(screen.queryByText('Pago aprobado')).toBeNull();
});
it.each(['aprobado', 'rechazado', 'pendiente'])('recupera %s al recargar', async estado => {
 vi.mocked(getPayment).mockResolvedValue({ ...payment, estado }); result(); expect(await screen.findByRole('heading', { level: 2 })).toBeTruthy();
});
it.each([401, 404])('no expone datos cuando backend responde %s', async status => {
 vi.mocked(getPurchase).mockRejectedValue(new ApiRequestError(status, 'No encontrada', 'Compra no encontrada'));
 result(); expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Compra no encontrada'); expect(getPayment).not.toHaveBeenCalled();
});
it.each(['aprobar', 'rechazar', 'pendiente'] as const)('envía %s sin abrir navegador de pago', async scenario => {
 const open = vi.spyOn(window, 'open'); vi.mocked(getPayment).mockRejectedValue(new ApiRequestError(404, 'Sin pago', 'Pago aún no iniciado'));
 vi.mocked(startPayment).mockResolvedValue(payment); checkout(); fireEvent.change(screen.getByRole('combobox'), { target: { value: scenario } }); fireEvent.click(screen.getByRole('button', { name: 'Simular pago' }));
 expect(await screen.findByText('Resultado desde servidor')).toBeTruthy(); expect(startPayment).toHaveBeenCalledWith('c', scenario); expect(open).not.toHaveBeenCalled();
});
it('reabre pago existente sin otro POST', async () => {
 checkout(); fireEvent.click(screen.getByRole('button', { name: 'Simular pago' })); expect(await screen.findByText('Resultado desde servidor')).toBeTruthy(); expect(startPayment).not.toHaveBeenCalled();
});
it('permite reintentar error de red sin inventar aprobación', async () => {
 vi.mocked(getPayment).mockRejectedValue(new ApiRequestError(404, 'Sin pago', 'Pago aún no iniciado')); vi.mocked(startPayment).mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValueOnce(payment);
 checkout(); fireEvent.click(screen.getByRole('button', { name: 'Simular pago' })); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Simular pago' })); expect(await screen.findByText('Resultado desde servidor')).toBeTruthy(); expect(startPayment).toHaveBeenCalledTimes(2);
});
