// src/__tests__/cliente-seguimientos.test.tsx
// INT4-128: la orden en vivo consulta el estado real por HTTP al enfocar y
// combina los cambios del WebSocket. El QR solo se ofrece en
// 'listo_para_retiro', el único estado en que Order lo habilita.
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import SeguimientosScreen from '../app/(cliente)/seguimientos';
import { useOrdenEstado } from '../hooks/useOrdenEstado';
import { obtenerCompra } from '../services/compras';
import { ApiError } from '../services/httpClient';
import { obtenerOrden } from '../services/ordenes';
import { desmontar, limpiarRouter, pulsar, routerMock, texto } from '../test-utils';
import type { Compra, Orden } from '../types/domain';

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);

jest.mock('../hooks/useOrdenEstado', () => ({
  useOrdenEstado: jest.fn(() => null),
}));

jest.mock('../services/compras', () => ({
  obtenerCompra: jest.fn(),
}));

jest.mock('../services/ordenes', () => ({
  obtenerOrden: jest.fn(),
}));

const mockUseOrdenEstado = useOrdenEstado as unknown as jest.Mock;
const mockObtenerCompra = obtenerCompra as unknown as jest.Mock;
const mockObtenerOrden = obtenerOrden as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;

function orden(sobre: Partial<Orden> = {}): Orden {
  return {
    ordenId: 'orden-1',
    codigoOrden: 'ORD-1',
    cafeteriaId: 'caf-1',
    cafeteriaNombre: 'Cafetería Central',
    estado: 'pagado',
    montoTotal: 1800,
    items: [],
    ...sobre,
  };
}

const COMPRA: Compra = {
  compraId: 'compra-1',
  montoTotal: 1800,
  estado: 'pagado',
  ordenes: [orden()],
};

async function renderizarSeguimiento(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<SeguimientosScreen />);
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
  mockUseLocalSearchParams.mockReset();
  mockUseOrdenEstado.mockReset();
  mockObtenerCompra.mockReset();
  mockObtenerOrden.mockReset();
  mockUseLocalSearchParams.mockReturnValue({ compraId: 'compra-1', ordenId: 'orden-1' });
  mockUseOrdenEstado.mockReturnValue(null);
  mockObtenerOrden.mockResolvedValue(orden());
  mockObtenerCompra.mockResolvedValue(COMPRA);
});

describe('pantalla de seguimiento en vivo', () => {
  it('carga el estado base de la orden por HTTP al ganar foco', async () => {
    const tree = await renderizarSeguimiento();

    expect(mockObtenerOrden).toHaveBeenCalledWith('orden-1');
    expect(mockUseOrdenEstado).toHaveBeenCalledWith('orden-1');
    expect(texto(tree, 'seguimiento-estado')).toContain('Pagado');
    expect(() => tree.root.findByProps({ testID: 'seguimiento-sin-qr' })).not.toThrow();

    desmontar(tree);
  });

  it('el estado del WebSocket gana sobre el estado base y habilita el QR', async () => {
    mockUseOrdenEstado.mockReturnValue('listo_para_retiro');

    const tree = await renderizarSeguimiento();

    expect(texto(tree, 'seguimiento-estado')).toContain('Listo para Retiro');
    await pulsar(tree, 'seguimiento-ver-qr');
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/qr-retiro',
      params: { compraId: 'compra-1', ordenId: 'orden-1' },
    });

    desmontar(tree);
  });

  it('con solo compraId resuelve la orden desde la compra', async () => {
    mockUseLocalSearchParams.mockReturnValue({ compraId: 'compra-1' });

    const tree = await renderizarSeguimiento();

    expect(mockObtenerCompra).toHaveBeenCalledWith('compra-1');
    expect(mockObtenerOrden).toHaveBeenCalledWith('orden-1');
    expect(texto(tree, 'seguimiento-orden')).toContain('ORD-1');

    desmontar(tree);
  });

  it('vuelve a consultar la orden cada vez que gana foco', async () => {
    const tree = await renderizarSeguimiento();

    const llamadas = mockUseFocusEffect.mock.calls;
    const callback = llamadas[llamadas.length - 1][0];
    await act(async () => {
      callback();
    });

    expect(mockObtenerOrden).toHaveBeenCalledTimes(2);

    desmontar(tree);
  });

  it('muestra error sin datos simulados cuando falla la consulta', async () => {
    mockObtenerOrden.mockRejectedValue(new ApiError('Servicio no disponible', 503));

    const tree = await renderizarSeguimiento();

    expect(tree.root.findByProps({ testID: 'seguimiento-error' })).toBeDefined();
    expect(tree.root.findAllByProps({ testID: 'seguimiento-timeline' })).toHaveLength(0);

    desmontar(tree);
  });

  it('sin compraId ni ordenId no consulta el backend', async () => {
    mockUseLocalSearchParams.mockReturnValue({});

    const tree = await renderizarSeguimiento();

    expect(mockObtenerCompra).not.toHaveBeenCalled();
    expect(mockObtenerOrden).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'seguimiento-error' })).toBeDefined();

    desmontar(tree);
  });
});
