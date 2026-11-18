// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { PurchasesPage } from './PurchasesPage';
import { PurchaseDetailPage } from './PurchaseDetailPage';
import { ApiRequestError } from '../services/httpClient';
import { cancelPurchase, confirmPurchase, connectPurchaseRealtimeStream, getPurchase, listPurchases, type Purchase } from '../services/purchases';

const auth = vi.hoisted(() => ({ userId: 'user-1' }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../config/env', () => ({ env: { apiBaseUrl: 'http://localhost:18080' } }));
vi.mock('../services/purchases', async original => ({ ...await original<typeof import('../services/purchases')>(), listPurchases: vi.fn(), getPurchase: vi.fn(), confirmPurchase: vi.fn(), cancelPurchase: vi.fn(), connectPurchaseRealtimeStream: vi.fn(() => () => {}) }));
const purchase: Purchase = { compraId: 'compra-1', clienteId: 'user-1', estado: 'revision_requerida', montoTotal: 5000, moneda: 'CLP', reservaExpiraAt: '', pago: null, creadoAt: '2026-11-17T12:00:00Z', ordenes: [
  { ordenId: 'a', cafeteriaNombre: 'Central', estado: 'revision_requerida', montoTotal: 3000, items: [{ ordenItemId: 'item', productoNombre: 'Café', cantidad: 2, precioUnitario: 1500, subtotal: 3000 }] },
  { ordenId: 'b', cafeteriaNombre: 'Norte', estado: 'pendiente_pago', montoTotal: 2000 },
] };
beforeEach(() => { vi.clearAllMocks(); auth.userId = 'user-1'; sessionStorage.clear(); vi.mocked(getPurchase).mockResolvedValue(purchase); vi.mocked(listPurchases).mockResolvedValue({ content: [purchase], number: 0, totalPages: 2, totalElements: 21, first: true, last: false }); });
afterEach(cleanup);
it('muestra un comprobante por orden pagada y oculta las impagas', async () => {
  vi.mocked(getPurchase).mockResolvedValue({ ...purchase, estado: 'pagado', pago: { estado: 'aprobado' },
    ordenes: purchase.ordenes.map(order => ({ ...order, estado: 'pagado' })) });
  view('/compras/compra-1');
  expect(await screen.findAllByRole('button', { name: 'Descargar comprobante PDF' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /b · Norte/ }));
  expect(screen.getByRole('article').id).toBe('orden-b');
  expect(screen.getAllByRole('button', { name: 'Descargar comprobante PDF' })).toHaveLength(1);
});
function view(path = '/compras') { return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/compras" element={<PurchasesPage />} /><Route path="/compras/:compraId" element={<PurchaseDetailPage />} /></Routes></MemoryRouter>); }

it('pagina desde backend y navega a detalle con una orden por cafetería', async () => {
  view(); fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
  await waitFor(() => expect(listPurchases).toHaveBeenCalledWith(1, expect.any(AbortSignal)));
  fireEvent.click(await screen.findByRole('link', { name: 'Compra compra-1' }));
  expect(await screen.findByText('Central')).toBeTruthy(); expect(screen.getByRole('button', { name: /b · Norte/ })).toBeTruthy(); expect(screen.getByText(/2 × Café/)).toBeTruthy();
});
it('muestra vacío y permite reintentar un error de red', async () => {
  vi.mocked(listPurchases).mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce({ content: [], number: 0, totalPages: 0, totalElements: 0, first: true, last: true });
  view(); expect(await screen.findByRole('alert')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText(/No hay compras/)).toBeTruthy();
});
it('no muestra datos de compra ajena', async () => {
  vi.mocked(getPurchase).mockRejectedValue(new ApiRequestError(404, 'No encontrada', 'Compra no encontrada'));
  view('/compras/ajena'); expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Compra no encontrada'); expect(screen.queryByText('Central')).toBeNull();
});
it('reintenta confirmar con la misma clave y solo actualiza al responder backend', async () => {
  vi.mocked(confirmPurchase).mockRejectedValueOnce(new ApiRequestError(503, 'Pendiente', 'Sigue procesando')).mockResolvedValueOnce({ ...purchase, estado: 'pendiente_pago' });
  view('/compras/compra-1'); fireEvent.click(await screen.findByRole('button', { name: 'Confirmar disponibilidad' }));
  await screen.findByText('Sigue procesando'); fireEvent.click(screen.getByRole('button', { name: 'Confirmar disponibilidad' }));
  await waitFor(() => expect(confirmPurchase).toHaveBeenCalledTimes(2)); expect(vi.mocked(confirmPurchase).mock.calls[0]).toEqual(vi.mocked(confirmPurchase).mock.calls[1]);
  expect(await screen.findByRole('button', { name: /Simular pago/ })).toBeTruthy();
});
it('cancelación y recarga por eventos conservan el estado canónico', async () => {
  vi.mocked(cancelPurchase).mockResolvedValue({ ...purchase, estado: 'cancelado', montoTotal: 0 });
  view('/compras/compra-1'); fireEvent.click(await screen.findByRole('button', { name: 'Cancelar compra' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelar compra' })).toBeNull());
  vi.mocked(getPurchase).mockResolvedValue({ ...purchase, estado: 'pagado', version: 3 });
  await act(async () => { vi.mocked(connectPurchaseRealtimeStream).mock.calls[0][0].onReconnect(); });
  expect(await screen.findByText(/Estado: pagado/)).toBeTruthy();
});
it('oculta el historial anterior inmediatamente cuando cambia el usuario', async () => {
  const tree = () => <MemoryRouter><PurchasesPage /></MemoryRouter>;
  const result = render(tree()); await screen.findByRole('link', { name: 'Compra compra-1' });
  vi.mocked(listPurchases).mockImplementation(() => new Promise(() => {})); auth.userId = 'user-2';
  result.rerender(tree()); expect(screen.queryByRole('link', { name: 'Compra compra-1' })).toBeNull();
});
