// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { CART_STORAGE_KEY, type CartItem } from '../services/catalog';
import { ApiRequestError } from '../services/httpClient';
import {
  cancelPurchase,
  confirmPurchase,
  createPurchase,
  type Purchase,
} from '../services/purchases';
import { CheckoutPage } from './CheckoutPage';

vi.mock('../services/purchases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/purchases')>();
  return {
    ...actual,
    cancelPurchase: vi.fn(),
    confirmPurchase: vi.fn(),
    createPurchase: vi.fn(),
  };
});

const item: CartItem = {
  offerId: 'offer-1',
  productId: 'product-1',
  productName: 'Café americano',
  cafeteriaId: 'cafeteria-1',
  cafeteriaName: 'Cafetería Central',
  price: 2500,
  quantity: 2,
  stock: 5,
};

const reviewPurchase: Purchase = {
  compraId: 'purchase-1',
  estado: 'revision_requerida',
  montoTotal: 4800,
  moneda: 'CLP',
  ordenes: [{
    ordenId: 'order-1',
    cafeteriaNombre: 'Cafetería Central',
    estado: 'revision_requerida',
    montoTotal: 4800,
  }],
  reservaExpiraAt: '2026-11-04T00:00:00Z',
  pago: null,
};

const confirmedPurchase: Purchase = { ...reviewPurchase, estado: 'pendiente_pago' };
const cancelledPurchase: Purchase = { ...reviewPurchase, estado: 'cancelado', montoTotal: 0 };

function renderCheckout() {
  return render(
    <MemoryRouter>
      <CheckoutPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  let keyNumber = 0;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([item]));
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `stable-key-${++keyNumber}`) });
  vi.mocked(createPurchase).mockReset();
  vi.mocked(confirmPurchase).mockReset();
  vi.mocked(cancelPurchase).mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('checkout web (INT2-88)', () => {
  it('muestra el total recibido del servidor y permite confirmar la compra en revisión', async () => {
    vi.mocked(createPurchase).mockResolvedValue(reviewPurchase);
    vi.mocked(confirmPurchase).mockResolvedValue(confirmedPurchase);
    renderCheckout();

    fireEvent.click(screen.getByRole('button', { name: 'Crear compra' }));
    expect(await screen.findByText('Total informado por el servidor:')).toBeTruthy();
    expect(screen.getAllByText('$4.800')).toHaveLength(2);
    expect(vi.mocked(createPurchase).mock.calls[0][0]).toEqual([
      { ofertaId: 'offer-1', cantidad: 2 },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar disponibilidad' }));
    expect(await screen.findByText('Estado:')).toBeTruthy();
    expect(screen.getByText('pendiente pago')).toBeTruthy();
  });

  it('reintenta una creación pendiente con la misma clave y el mismo cuerpo', async () => {
    vi.mocked(createPurchase)
      .mockRejectedValueOnce(new ApiRequestError(
        503,
        'Servicio no disponible',
        'La operación sigue procesándose.',
        null,
        null,
        [],
        'OPERACION_PENDIENTE',
      ))
      .mockResolvedValueOnce(reviewPurchase);
    const checkout = renderCheckout();

    fireEvent.click(screen.getByRole('button', { name: 'Crear compra' }));
    await screen.findByRole('button', { name: 'Reintentar creación' });
    checkout.unmount();
    renderCheckout();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar creación' }));

    expect(createPurchase).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createPurchase).mock.calls[0]).toEqual(
      vi.mocked(createPurchase).mock.calls[1],
    );
    expect(vi.mocked(createPurchase).mock.calls[0][1]).toBe('stable-key-1');
    expect(await screen.findByText('Total informado por el servidor:')).toBeTruthy();
  });

  it('permite cancelar la compra que quedó en revisión', async () => {
    vi.mocked(createPurchase).mockResolvedValue(reviewPurchase);
    vi.mocked(cancelPurchase).mockResolvedValue(cancelledPurchase);
    renderCheckout();

    fireEvent.click(screen.getByRole('button', { name: 'Crear compra' }));
    await screen.findByRole('button', { name: 'Cancelar compra' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar compra' }));

    expect(await screen.findByText('La compra fue cancelada.')).toBeTruthy();
    expect(cancelPurchase).toHaveBeenCalledWith('purchase-1', 'stable-key-2');
  });
});
