// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { CART_STORAGE_KEY, type CartItem } from '../services/catalog';
import { ApiRequestError } from '../services/httpClient';
import {
  cancelPurchase,
  getPurchase,
  confirmPurchase,
  createPurchase,
  type Purchase,
} from '../services/purchases';
import { CheckoutPage } from './CheckoutPage';

vi.mock('../config/env', () => ({
  env: {
    appTitle: 'CloudCoffee Test',
    apiBaseUrl: 'http://localhost:18080',
  },
}));

vi.mock('../services/purchases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/purchases')>();
  return {
    ...actual,
    cancelPurchase: vi.fn(),
    confirmPurchase: vi.fn(),
    createPurchase: vi.fn(),
    getPurchase: vi.fn(),
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

  it('actualiza estado de compra y órdenes por WebSocket, reconcilia por HTTP al reconectar y limpia al expirar sesión (INT2-139)', async () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(
      JSON.stringify({
        sub: 'cliente-1',
        role: 'CLIENTE',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    localStorage.setItem('accessToken', `${header}.${body}.signature`);

    const sentFrames: string[] = [];
    const socketRef: { current: CheckoutFakeWebSocket | null } = { current: null };

    class CheckoutFakeWebSocket {
      static readonly OPEN = 1;
      static readonly CLOSED = 3;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        socketRef.current = this;
      }
      send(frame: string) {
        sentFrames.push(frame);
      }
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
    }

    vi.stubGlobal('WebSocket', CheckoutFakeWebSocket);
    vi.mocked(createPurchase).mockResolvedValue({ ...reviewPurchase, clienteId: 'cliente-1', version: 1 });
    vi.mocked(getPurchase).mockResolvedValue({
      ...confirmedPurchase,
      clienteId: 'cliente-1',
      estado: 'pagado',
      version: 3,
      ordenes: [{ ...confirmedPurchase.ordenes[0], estado: 'listo_para_retiro', version: 3 }],
    });

    renderCheckout();
    fireEvent.click(screen.getByRole('button', { name: 'Crear compra' }));
    expect(await screen.findByText('Compra purchase-1')).toBeTruthy();

    await act(async () => {
      socketRef.current?.onopen?.();
      socketRef.current?.onmessage?.({ data: 'CONNECTED\nversion:1.2\n\n\0' } as MessageEvent);
    });

    expect(sentFrames.some((f) => f.includes('destination:/topic/compra/purchase-1/estado'))).toBe(true);
    expect(sentFrames.some((f) => f.includes('destination:/topic/orden/order-1/estado'))).toBe(true);

    // Evento WebSocket cambia la compra a pendiente_pago (version 2)
    await act(async () => {
      socketRef.current?.onmessage?.({
        data: `MESSAGE\ndestination:/topic/compra/purchase-1/estado\n\n${JSON.stringify({
          eventId: 'evt-compra-2',
          traceId: 'trace-c2',
          eventType: 'order.compra.estado-cambiado.v1',
          payload: {
            compraId: 'purchase-1',
            clienteId: 'cliente-1',
            estado: 'pendiente_pago',
            montoTotal: 4800,
            version: 2,
          },
        })}\0`,
      } as MessageEvent);
    });

    expect(await screen.findByText('pendiente pago')).toBeTruthy();

    // Salto de versión (version 4) dispara reconciliación HTTP con getPurchase
    await act(async () => {
      socketRef.current?.onmessage?.({
        data: `MESSAGE\ndestination:/topic/compra/purchase-1/estado\n\n${JSON.stringify({
          eventId: 'evt-compra-4',
          traceId: 'trace-c4',
          eventType: 'order.compra.estado-cambiado.v1',
          payload: {
            compraId: 'purchase-1',
            clienteId: 'cliente-1',
            estado: 'pagado',
            montoTotal: 4800,
            version: 4,
          },
        })}\0`,
      } as MessageEvent);
    });

    expect(await screen.findByText('listo para retiro')).toBeTruthy();
    expect(getPurchase).toHaveBeenCalledWith('purchase-1');

    // Cambio de usuario en sesión limpia la compra de otro usuario y desconecta WebSocket
    const otherBody = btoa(
      JSON.stringify({
        sub: 'cliente-2',
        role: 'CLIENTE',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    await act(async () => {
      localStorage.setItem('accessToken', `${header}.${otherBody}.signature`);
      window.dispatchEvent(new Event('auth:session-change'));
    });

    expect(await screen.findByText('No hay productos para comprar.')).toBeTruthy();
    await waitFor(() => {
      expect(sentFrames.some((f) => f.startsWith('UNSUBSCRIBE\n'))).toBe(true);
      expect(sentFrames.some((f) => f.startsWith('DISCONNECT\n'))).toBe(true);
    });
  });
});