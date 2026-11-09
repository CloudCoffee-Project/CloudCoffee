// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../components/common/ProtectedRoute';
import { AuthProvider } from '../contexts/AuthContext';
import { ApiRequestError } from '../services/httpClient';
import * as httpClient from '../services/httpClient';
import { CashierOrderPage } from '../services/cashierOrders';
import { CashierOrdersPage } from './CashierOrdersPage';

vi.mock('../config/env', () => ({
  env: {
    appTitle: 'CloudCoffee Test',
    apiBaseUrl: 'http://localhost:18080',
  },
}));

vi.mock('../services/httpClient', async () => {
  const actual = await vi.importActual<typeof import('../services/httpClient')>(
    '../services/httpClient',
  );
  return {
    ...actual,
    request: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue(null),
  };
});

function createJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
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
    this.onmessage?.({
      data: 'CONNECTED\nversion:1.2\n\n\0',
    } as MessageEvent);
  }

  simulateMessage(payload: unknown) {
    const body = JSON.stringify(payload);
    this.onmessage?.({
      data: `MESSAGE\ndestination:/topic/cafeteria/caf-1/ordenes\ncontent-type:application/json\n\n${body}\0`,
    } as MessageEvent);
  }
}

const sampleOrdersPage: CashierOrderPage = {
  content: [
    {
      ordenId: 'ord-1',
      compraId: 'comp-1',
      codigoOrden: 'ORD-101',
      cafeteriaId: 'caf-1',
      cafeteriaNombre: 'Cafetería Central',
      estado: 'pagado',
      montoTotal: 4500,
      moneda: 'CLP',
      items: [
        {
          ordenItemId: 'item-1',
          ofertaId: 'of-1',
          productoId: 'prod-1',
          productoNombre: 'Latte Vainilla',
          cantidad: 2,
          precioUnitario: 2250,
          subtotal: 4500,
        },
      ],
      reservaExpiraAt: null,
      retiroHasta: '2026-11-03T20:00:00Z',
      entregadoAt: null,
      creadoAt: '2026-11-03T18:00:00Z',
      actualizadoAt: '2026-11-03T18:01:00Z',
      version: 1,
    },
  ],
  number: 0,
  size: 20,
  totalElements: 1,
  totalPages: 1,
  first: true,
  last: true,
  empty: false,
};

function renderCashierRoute(initialEntry = '/cajero') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<div>Página de Login</div>} />
          <Route path="/" element={<div>Página de Inicio</div>} />
          <Route element={<ProtectedRoute allowedRoles={['CAJERO']} />}>
            <Route path="/cajero" element={<CashierOrdersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('CashierOrdersPage (INT2-62)', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.WebSocket = originalWebSocket;
  });

  it('lista los pedidos de la cafetería autorizada y permite filtrar por estado y código', async () => {
    const token = createJwt({
      sub: 'cajero-1',
      role: 'CAJERO',
      cafeteriaId: 'caf-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorage.setItem('accessToken', token);

    vi.mocked(httpClient.request).mockResolvedValue(sampleOrdersPage);

    renderCashierRoute();

    expect(await screen.findByText('ORD-101')).toBeTruthy();
    expect(screen.getByText('Cafetería Central')).toBeTruthy();
    expect(screen.getByText(/Latte Vainilla/i)).toBeTruthy();
    expect(httpClient.request).toHaveBeenCalledWith(
      '/v1/orders?page=0&size=20',
      expect.objectContaining({ method: 'GET' }),
    );

    // Filtrar por estado "listo_para_retiro"
    fireEvent.change(screen.getByLabelText(/Estado del pedido/i), {
      target: { value: 'listo_para_retiro' },
    });

    await waitFor(() => {
      expect(httpClient.request).toHaveBeenCalledWith(
        '/v1/orders?page=0&size=20&estado=listo_para_retiro',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    // Filtrar por código de orden
    fireEvent.change(screen.getByLabelText(/Código de orden/i), {
      target: { value: 'ORD-101' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Filtrar$/i }));

    await waitFor(() => {
      expect(httpClient.request).toHaveBeenCalledWith(
        '/v1/orders?page=0&size=20&estado=listo_para_retiro&codigoOrden=ORD-101',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  it('actualiza el estado del pedido por WebSocket y reconcilia por HTTP tras reconexión', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const token = createJwt({
        sub: 'cajero-1',
        role: 'CAJERO',
        cafeteriaId: 'caf-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });
      localStorage.setItem('accessToken', token);

      const updatedPage: CashierOrderPage = {
        ...sampleOrdersPage,
        content: [
          {
            ...sampleOrdersPage.content[0],
            estado: 'listo_para_retiro',
          },
        ],
      };

      vi.mocked(httpClient.request)
        .mockResolvedValueOnce(sampleOrdersPage)
        .mockResolvedValue(updatedPage);

      renderCashierRoute();

      expect(await screen.findByText('ORD-101')).toBeTruthy();
      expect(FakeWebSocket.instances).toHaveLength(1);

      const firstSocket = FakeWebSocket.instances[0];
      act(() => {
        firstSocket.simulateOpenAndConnected();
      });

      expect(screen.getByText('Conectado en tiempo real')).toBeTruthy();
      expect(firstSocket.sentFrames.some((f) => f.includes('destination:/topic/cafeteria/caf-1/ordenes'))).toBe(
        true,
      );

      // Emitir evento STOMP de cambio de estado a "listo_para_retiro"
      act(() => {
        firstSocket.simulateMessage({
          eventId: 'evt-1',
          eventType: 'order.orden.estado-cambiado.v1',
          occurredAt: '2026-11-03T18:05:00Z',
          payload: {
            ordenId: 'ord-1',
            cafeteriaId: 'caf-1',
            estado: 'listo_para_retiro',
          },
        });
      });

      expect(await screen.findByText(/Pedido actualizado en tiempo real/i)).toBeTruthy();

      const callsBeforeDisconnect = vi.mocked(httpClient.request).mock.calls.length;

      // Simular caída de conexión WebSocket y posterior reconexión automática
      act(() => {
        firstSocket.close();
      });

      expect(screen.getByText('Reconectando tiempo real…')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(3100);
      });

      expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
      const secondSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

      act(() => {
        secondSocket.simulateOpenAndConnected();
      });

      // Debe reconciliar por HTTP tras reconectar
      await waitFor(() => {
        expect(vi.mocked(httpClient.request).mock.calls.length).toBeGreaterThan(callsBeforeDisconnect);
      });
      expect(
        screen.getByText(/Conexión restablecida: pedidos reconciliados con el servidor/i),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('muestra error y permite reintentar cuando falla la petición HTTP', async () => {
    const token = createJwt({
      sub: 'cajero-1',
      role: 'CAJERO',
      cafeteriaId: 'caf-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorage.setItem('accessToken', token);

    vi.mocked(httpClient.request)
      .mockRejectedValueOnce(new ApiRequestError(503, 'Servicio no disponible', 'Order service temporalmente fuera de línea.'))
      .mockResolvedValueOnce(sampleOrdersPage);

    renderCashierRoute();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Order service temporalmente fuera de línea.');

    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));

    expect(await screen.findByText('ORD-101')).toBeTruthy();
  });

  it('restringe el acceso a la ruta /cajero únicamente al rol CAJERO', () => {
    const clientToken = createJwt({
      sub: 'cliente-1',
      role: 'CLIENTE',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorage.setItem('accessToken', clientToken);

    renderCashierRoute();

    expect(screen.getByText('Acceso restringido')).toBeTruthy();
    expect(screen.getByText(/no tiene permisos para visualizar esta página/i)).toBeTruthy();
    expect(screen.queryByText('Panel de Cajero')).not.toBeTruthy();
    expect(httpClient.request).not.toHaveBeenCalled();
  });

  it('ignora eventos duplicados con traceId o versiones anteriores y reconcilia por HTTP ante saltos de versión (INT2-81)', async () => {
    const token = createJwt({
      sub: 'cajero-1',
      role: 'CAJERO',
      cafeteriaId: 'caf-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    localStorage.setItem('accessToken', token);

    const reconciledPageV3: CashierOrderPage = {
      ...sampleOrdersPage,
      content: [
        {
          ...sampleOrdersPage.content[0],
          estado: 'entregado',
          entregadoAt: '2026-11-03T18:10:00Z',
          version: 3,
        },
      ],
    };

    vi.mocked(httpClient.request)
      .mockResolvedValueOnce(sampleOrdersPage)
      .mockResolvedValue(reconciledPageV3);

    renderCashierRoute();

    expect(await screen.findByText('ORD-101')).toBeTruthy();
    const socket = FakeWebSocket.instances[0];
    act(() => {
      socket.simulateOpenAndConnected();
    });

    const initialHttpCalls = vi.mocked(httpClient.request).mock.calls.length;

    // 1. Evento consecutivo (version: 2) con traceId: actualiza en memoria sin requerir salto HTTP
    const eventV2 = {
      eventId: 'evt-v2-duplicado',
      traceId: 'trace-orden-101-v2',
      eventType: 'order.orden.estado-cambiado.v1',
      timestamp: '2026-11-03T18:05:00Z',
      payload: {
        ordenId: 'ord-1',
        cafeteriaId: 'caf-1',
        estadoAnterior: 'pagado',
        estado: 'listo_para_retiro',
        version: 2,
      },
    };

    act(() => {
      socket.simulateMessage(eventV2);
      // Enviar exactamente el mismo evento duplicado con el mismo eventId y traceId
      socket.simulateMessage(eventV2);
    });

    expect(
      await screen.findByText(/Pedido actualizado en tiempo real \(Listo para retiro\)/i),
    ).toBeTruthy();
    expect(vi.mocked(httpClient.request).mock.calls.length).toBe(initialHttpCalls);

    // 2. Evento obsoleto (version: 1) llega tarde: debe ser ignorado y mantener 'Listo para retiro'
    act(() => {
      socket.simulateMessage({
        eventId: 'evt-v1-tardio',
        traceId: 'trace-orden-101-v1',
        eventType: 'order.orden.estado-cambiado.v1',
        timestamp: '2026-11-03T18:01:00Z',
        payload: {
          ordenId: 'ord-1',
          cafeteriaId: 'caf-1',
          estado: 'pendiente_pago',
          version: 1,
        },
      });
    });

    expect(screen.queryByText('Pendiente de pago', { selector: '.cashier-order-status' })).toBeNull();

    // 3. Salto de versión (version: 4 cuando local es 2) dispara reconciliación HTTP
    act(() => {
      socket.simulateMessage({
        eventId: 'evt-v4-salto',
        traceId: 'trace-orden-101-v4',
        eventType: 'order.orden.estado-cambiado.v1',
        timestamp: '2026-11-03T18:10:00Z',
        payload: {
          ordenId: 'ord-1',
          cafeteriaId: 'caf-1',
          estado: 'entregado',
          version: 4,
        },
      });
    });

    await waitFor(() => {
      expect(vi.mocked(httpClient.request).mock.calls.length).toBeGreaterThan(initialHttpCalls);
    });
  });
});