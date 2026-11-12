// @vitest-environment jsdom
import { act ,waitFor , cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailPage } from './ProductDetailPage';
import { ApiRequestError, request, AUTH_SESSION_EVENT } from '../services/httpClient';
import { CART_STORAGE_KEY, readCartItems } from '../services/catalog';

vi.mock('../services/httpClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/httpClient')>(),
  request: vi.fn(),
}));

const productId = '33333333-3333-4333-8333-333333333333';
const campusA = '11111111-1111-4111-8111-111111111111';
const campusB = '11111111-1111-4111-8111-222222222222';

const sampleProduct = {
  id: productId,
  nombre: 'Café Latte Artesanal',
  descripcion: 'Espresso doble con leche vaporizada.',
  imagenUrl: 'https://cloudcoffee.example/latte.png',
  categoria: {
    id: '22222222-2222-4222-8222-222222222222',
    nombre: 'Cafetería Caliente',
  },
};

const sampleCampus = [
  { id: campusA, nombre: 'Campus San Francisco' },
  { id: campusB, nombre: 'Campus San Juan Pablo II' },
];

const sampleOffers = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cafeteriaId: '44444444-4444-4444-8444-444444444444',
    cafeteriaName: 'Cafetería Central',
    price: 2200,
    stock: 5,
    disponible: true,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    cafeteriaId: '55555555-5555-4555-8555-555555555555',
    cafeteriaName: 'Kiosco Norte',
    price: 2000,
    stock: 0,
    disponible: false,
  },
];

function renderDetail(initialEntry = `/catalogo/productos/${productId}?campusId=${campusA}`) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/catalogo" element={<h1>Catálogo Principal</h1>} />
        <Route path="/catalogo/productos/:id" element={<ProductDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(request).mockImplementation((path: string) => {
    if (path === `/v1/catalog/productos/${productId}`) {
      return Promise.resolve(sampleProduct);
    }
    if (path === '/v1/catalog/campus') {
      return Promise.resolve(sampleCampus);
    }
    if (path.startsWith(`/v1/catalog/productos/${productId}/ofertas?`)) {
      return Promise.resolve(sampleOffers);
    }
    return Promise.reject(new Error(`Ruta no esperada: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('detalle de producto en web (INT2-102)', () => {
  it('muestra descripción, imagen, categoría y ofertas del campus seleccionado', async () => {
    renderDetail();

    expect(screen.getByRole('heading', { name: 'Cargando producto…' })).toBeTruthy();

    expect(await screen.findByRole('heading', { name: 'Café Latte Artesanal' })).toBeTruthy();
    expect(screen.getByText('Cafetería Caliente')).toBeTruthy();
    expect(screen.getByText('Espresso doble con leche vaporizada.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Café Latte Artesanal' }).getAttribute('src')).toBe(
      'https://cloudcoffee.example/latte.png',
    );

    expect(await screen.findByRole('heading', { name: 'Cafetería Central' })).toBeTruthy();
    expect(screen.getByText('Stock disponible: 5')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Kiosco Norte' })).toBeTruthy();
    expect(screen.getByText('Sin stock disponible')).toBeTruthy();

    expect(vi.mocked(request).mock.calls.every(([, options]) => options?.omitAccessToken === true)).toBe(true);
  });

  it('permite agregar una oferta disponible al carrito respetando el stock y deshabilita ofertas sin stock', async () => {
    renderDetail();

    await screen.findByRole('heading', { name: 'Cafetería Central' });

    const qtyInput = screen.getByLabelText('Cantidad para Cafetería Central') as HTMLInputElement;
    fireEvent.change(qtyInput, { target: { value: '3' } });

    const addButton = screen.getByRole('button', { name: 'Agregar al carrito' });
    const outOfStockButton = screen.getByRole('button', { name: 'Sin stock' }) as HTMLButtonElement;
    expect(outOfStockButton.disabled).toBe(true);

    fireEvent.click(addButton);

    expect(
      screen.getByText('Se agregó 3 unidades de Café Latte Artesanal (Cafetería Central) al carrito.'),
    ).toBeTruthy();

    const stored = readCartItems();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      offerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      productId,
      productName: 'Café Latte Artesanal',
      cafeteriaName: 'Cafetería Central',
      price: 2200,
      quantity: 3,
      stock: 5,
    });

    // Si vuelve a agregar 4 unidades, no debe superar el stock máximo de 5
    fireEvent.change(qtyInput, { target: { value: '4' } });
    fireEvent.click(addButton);
    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]')[0].quantity).toBe(5);
  });

  it('muestra estado de producto inexistente (404) y permite retornar al catálogo', async () => {
    vi.mocked(request).mockImplementation((path: string) => {
      if (path === `/v1/catalog/productos/${productId}`) {
        return Promise.reject(
          new ApiRequestError(
            404,
            'Producto no encontrado',
            'No existe un producto activo con el identificador indicado.',
            '/problems/producto-no-encontrado',
          ),
        );
      }
      if (path === '/v1/catalog/campus') {
        return Promise.resolve(sampleCampus);
      }
      return Promise.resolve([]);
    });

    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Producto no encontrado' })).toBeTruthy();
    expect(screen.getByText('No existe un producto activo con el identificador indicado.')).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Volver al catálogo' }));
    expect(await screen.findByRole('heading', { name: 'Catálogo Principal' })).toBeTruthy();
  });

  it('muestra estado de error y permite reintentar la carga del producto', async () => {
    vi.mocked(request).mockRejectedValueOnce(
      new ApiRequestError(503, 'Servicio no disponible', 'El catálogo no responde temporalmente.'),
    );

    renderDetail();

    expect(await screen.findByText('El catálogo no responde temporalmente.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('heading', { name: 'Café Latte Artesanal' })).toBeTruthy();
  });
});
vi.mock('../config/env', () => ({
  env: {
    appTitle: 'CloudCoffee Test',
    apiBaseUrl: 'http://localhost:18080',
  },
}));

function createClientJwt(sub = 'cliente-1'): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(
    JSON.stringify({
      sub,
      role: 'CLIENTE',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  return `${header}.${body}.signature`;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sentFrames: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentFrames.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpenAndConnected() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
    this.onmessage?.({ data: 'CONNECTED\nversion:1.2\n\n\0' } as MessageEvent);
  }

  simulateMessage(destination: string, payload: unknown) {
    const body = JSON.stringify(payload);
    this.onmessage?.({
      data: `MESSAGE\ndestination:${destination}\ncontent-type:application/json\n\n${body}\0`,
    } as MessageEvent);
  }
}
describe('actualización de stock por WebSocket en detalle de producto (INT2-139)', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it('actualiza stock a cero y reposición por WebSocket y descarta eventos fuera de orden o duplicados', async () => {
    localStorage.setItem('accessToken', createClientJwt('cliente-1'));
    renderDetail();

    expect(await screen.findByText('Stock disponible: 5')).toBeTruthy();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    await act(async () => {
      ws.simulateOpenAndConnected();
    });

    expect(
      ws.sentFrames.some((f) =>
        f.includes('destination:/topic/cafeteria/44444444-4444-4444-8444-444444444444/stock'),
      ),
    ).toBe(true);

    // Stock cae a 0 (version 2)
    await act(async () => {
      ws.simulateMessage('/topic/cafeteria/44444444-4444-4444-8444-444444444444/stock', {
        eventId: 'evt-stock-2',
        traceId: 'trace-stock-2',
        eventType: 'catalog.stock.actualizado.v1',
        payload: {
          ofertaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          productoId: productId,
          cafeteriaId: '44444444-4444-4444-8444-444444444444',
          campusId: campusA,
          stockActual: 0,
          version: 2,
        },
      });
    });

    expect(screen.getAllByText('Sin stock disponible')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Sin stock' })).toHaveLength(2);

    // Reposición a 7 unidades (version 3)
    await act(async () => {
      ws.simulateMessage('/topic/cafeteria/44444444-4444-4444-8444-444444444444/stock', {
        eventId: 'evt-stock-3',
        traceId: 'trace-stock-3',
        eventType: 'catalog.stock.actualizado.v1',
        payload: {
          ofertaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          productoId: productId,
          cafeteriaId: '44444444-4444-4444-8444-444444444444',
          campusId: campusA,
          stockActual: 7,
          version: 3,
        },
      });
    });

    expect(screen.getByText('Stock disponible: 7')).toBeTruthy();

    // Evento fuera de orden (version 2) se descarta
    await act(async () => {
      ws.simulateMessage('/topic/cafeteria/44444444-4444-4444-8444-444444444444/stock', {
        eventId: 'evt-stock-old',
        traceId: 'trace-stock-old',
        eventType: 'catalog.stock.actualizado.v1',
        payload: {
          ofertaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          productoId: productId,
          cafeteriaId: '44444444-4444-4444-8444-444444444444',
          campusId: campusA,
          stockActual: 1,
          version: 2,
        },
      });
    });

    expect(screen.getByText('Stock disponible: 7')).toBeTruthy();
  });

  it('reconcilia ofertas por HTTP tras reconexión y cancela suscripciones al cambiar campus o expirar sesión', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    localStorage.setItem('accessToken', createClientJwt('cliente-1'));
    renderDetail();

    expect(await screen.findByText('Stock disponible: 5')).toBeTruthy();
    const ws1 = FakeWebSocket.instances[0];

    await act(async () => {
      ws1.simulateOpenAndConnected();
    });

    // Preparar respuesta HTTP actualizada tras reconexión
    vi.mocked(request).mockImplementation((path: string) => {
      if (path.startsWith(`/v1/catalog/productos/${productId}/ofertas?`)) {
        return Promise.resolve([
          { ...sampleOffers[0], stock: 9, disponible: true, version: 4 },
          sampleOffers[1],
        ]);
      }
      if (path === `/v1/catalog/productos/${productId}`) return Promise.resolve(sampleProduct);
      if (path === '/v1/catalog/campus') return Promise.resolve(sampleCampus);
      return Promise.resolve([]);
    });

    await act(async () => {
      ws1.close();
      vi.advanceTimersByTime(3100);
    });

    const ws2 = FakeWebSocket.instances[1];
    await act(async () => {
      ws2.simulateOpenAndConnected();
    });

    expect(await screen.findByText('Stock disponible: 9')).toBeTruthy();

    // Expirar sesión cancela suscripciones activas
    await act(async () => {
      localStorage.removeItem('accessToken');
      window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
    });

    await waitFor(() => {
      expect(ws2.sentFrames.some((f) => f.startsWith('UNSUBSCRIBE\n'))).toBe(true);
      expect(ws2.sentFrames.some((f) => f.startsWith('DISCONNECT\n'))).toBe(true);
    });

    vi.useRealTimers();
  });
});