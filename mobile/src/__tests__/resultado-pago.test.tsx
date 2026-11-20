// src/__tests__/resultado-pago.test.tsx
//
// INT4-128: resultado-pago NO decide con el parámetro `estado` que venía del
// viejo flujo de Mercado Pago. Al ganar foco consulta GET /v1/compras/{id} y
// navega con el pago real: aprobado → QR, pendiente → seguimiento, rechazado →
// carrito (que no se vació).
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import ResultadoPagoScreen from '../app/(cliente)/resultado-pago';
import { obtenerCompra } from '../services/compras';
import { ApiError } from '../services/httpClient';
import { desmontar, limpiarRouter, pulsar, routerMock, texto } from '../test-utils';
import type { Compra, EstadoPago, Orden } from '../types/domain';

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);

jest.mock('../services/compras', () => ({
  obtenerCompra: jest.fn(),
}));

const mockObtenerCompra = obtenerCompra as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;

function orden(sobre: Partial<Orden> = {}): Orden {
  return {
    ordenId: 'orden-1',
    codigoOrden: 'ORD-1',
    cafeteriaId: 'caf-1',
    cafeteriaNombre: 'Cafetería Central',
    estado: 'pendiente_pago',
    montoTotal: 1800,
    items: [],
    ...sobre,
  };
}

function compraConPago(estadoPago: EstadoPago, sobre: Partial<Compra> = {}): Compra {
  return {
    compraId: 'compra-123',
    montoTotal: 1800,
    estado: 'pendiente_pago',
    ordenes: [orden()],
    pago: {
      pagoId: 'pago-456',
      compraId: 'compra-123',
      estado: estadoPago,
      motivo:
        estadoPago === 'aprobado'
          ? 'aprobacion_simulada'
          : estadoPago === 'rechazado'
            ? 'rechazo_simulado'
            : 'escenario_pendiente',
      montoTotal: 1800,
      moneda: 'CLP',
      simulado: true,
      proveedor: 'simulado',
      creadoAt: '2026-01-01T00:00:00Z',
      actualizadoAt: '2026-01-01T00:00:00Z',
      version: 1,
    },
    ...sobre,
  };
}

// El mock de useFocusEffect no ejecuta callbacks automáticamente: se invoca
// manualmente el último para simular que la pantalla ganó foco.
async function renderizarResultado(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ResultadoPagoScreen />);
  });

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });

  return tree;
}

beforeEach(() => {
  limpiarRouter();
  mockUseFocusEffect.mockReset();
  mockObtenerCompra.mockReset();
  mockUseLocalSearchParams.mockReset();
  mockUseLocalSearchParams.mockReturnValue({
    compraId: 'compra-123',
    pagoId: 'pago-456',
  });
});

describe('pantalla resultado-pago (estado real de Order)', () => {
  it('con pago aprobado navega al QR con el compraId', async () => {
    mockObtenerCompra.mockResolvedValue(compraConPago('aprobado'));

    const tree = await renderizarResultado();

    expect(mockObtenerCompra).toHaveBeenCalledWith('compra-123');
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/(cliente)/qr-retiro',
      params: { compraId: 'compra-123' },
    });
    expect(() => tree.root.findByProps({ testID: 'resultado-ir-qr' })).not.toThrow();

    desmontar(tree);
  });

  it('con pago pendiente navega a la orden en vivo con compraId y ordenId', async () => {
    mockObtenerCompra.mockResolvedValue(compraConPago('pendiente'));

    const tree = await renderizarResultado();

    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/(cliente)/seguimientos',
      params: { compraId: 'compra-123', ordenId: 'orden-1' },
    });

    desmontar(tree);
  });

  it('con pago rechazado ofrece volver al carrito sin vaciarlo', async () => {
    mockObtenerCompra.mockResolvedValue(compraConPago('rechazado'));

    const tree = await renderizarResultado();

    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(texto(tree, 'resultado-titulo')).toBe('Pago rechazado');
    expect(texto(tree, 'resultado-compra')).toContain('compra-123');
    expect(texto(tree, 'resultado-pago')).toContain('pago-456');

    await pulsar(tree, 'resultado-ir-carrito');
    expect(routerMock.replace).toHaveBeenCalledWith('/carrito');

    desmontar(tree);
  });

  it('no confía en el parámetro estado del flujo histórico', async () => {
    mockObtenerCompra.mockResolvedValue(compraConPago('rechazado'));
    mockUseLocalSearchParams.mockReturnValue({
      estado: 'exitoso',
      compraId: 'compra-123',
      paymentId: 'pago-456',
    });

    const tree = await renderizarResultado();

    expect(texto(tree, 'resultado-titulo')).toBe('Pago rechazado');
    expect(routerMock.replace).not.toHaveBeenCalled();

    desmontar(tree);
  });

  it('si falla la consulta muestra error con reintento y vuelve a consultar', async () => {
    mockObtenerCompra
      .mockRejectedValueOnce(new ApiError('Servicio no disponible', 503))
      .mockResolvedValueOnce(compraConPago('aprobado'));

    const tree = await renderizarResultado();

    expect(texto(tree, 'resultado-titulo')).toBe('No pudimos confirmar el estado');
    expect(texto(tree, 'resultado-mensaje')).toContain('Servicio no disponible');

    await pulsar(tree, 'resultado-reintentar');

    expect(mockObtenerCompra).toHaveBeenCalledTimes(2);
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/(cliente)/qr-retiro',
      params: { compraId: 'compra-123' },
    });

    desmontar(tree);
  });

  it('sin compraId no consulta el backend y explica el problema', async () => {
    mockUseLocalSearchParams.mockReturnValue({ estado: 'exitoso' });

    const tree = await renderizarResultado();

    expect(mockObtenerCompra).not.toHaveBeenCalled();
    expect(texto(tree, 'resultado-mensaje')).toContain('No hay una compra asociada');

    desmontar(tree);
  });
});
