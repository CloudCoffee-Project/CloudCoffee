// src/__tests__/cliente-qr-retiro.test.tsx
// INT4-128: el Código de Retiro muestra SOLAMENTE el código opaco que devuelve
// GET /v1/orders/{ordenId}/qr. Si Order no lo habilita, no se arma un QR local:
// se ofrece el seguimiento en vivo. Conserva el enlace a la boleta (INT4-48).
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import QrRetiroScreen from '../app/(cliente)/qr-retiro';
import { obtenerCompra } from '../services/compras';
import { ApiError } from '../services/httpClient';
import { obtenerOrden, obtenerQrRetiro } from '../services/ordenes';
import { desmontar, limpiarRouter, pulsar, routerMock } from '../test-utils';
import type { Compra, Orden, QrRetiroBackend } from '../types/domain';

jest.mock('react-native-qrcode-svg', () => 'QRCode');

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);

jest.mock('../services/compras', () => ({
  obtenerCompra: jest.fn(),
}));

jest.mock('../services/ordenes', () => ({
  obtenerOrden: jest.fn(),
  obtenerQrRetiro: jest.fn(),
}));

const mockObtenerCompra = obtenerCompra as unknown as jest.Mock;
const mockObtenerOrden = obtenerOrden as unknown as jest.Mock;
const mockObtenerQrRetiro = obtenerQrRetiro as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;

const ORDEN: Orden = {
  ordenId: 'orden-1',
  codigoOrden: 'ORD-1',
  cafeteriaId: 'caf-1',
  cafeteriaNombre: 'Cafetería Central',
  estado: 'listo_para_retiro',
  montoTotal: 1800,
  items: [],
};

const COMPRA: Compra = {
  compraId: 'compra-1',
  montoTotal: 1800,
  estado: 'pagado',
  ordenes: [ORDEN],
};

const QR: QrRetiroBackend = {
  ordenId: 'orden-1',
  codigo: 'codigo-opaco-de-order-1234567890',
  expiraAt: '2026-01-01T01:00:00Z',
};

// El mock de useFocusEffect captura el callback: ejecutarlo equivale a que la
// pantalla gane foco y vuelva a consultar el QR al backend.
async function renderizarQr(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<QrRetiroScreen />);
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
  mockObtenerCompra.mockReset();
  mockObtenerOrden.mockReset();
  mockObtenerQrRetiro.mockReset();
  mockUseLocalSearchParams.mockReturnValue({ compraId: 'compra-1' });
  mockObtenerCompra.mockResolvedValue(COMPRA);
  mockObtenerOrden.mockResolvedValue(ORDEN);
  mockObtenerQrRetiro.mockResolvedValue(QR);
});

describe('pantalla de Código de Retiro (QR del backend)', () => {
  it('resuelve la orden desde compraId y muestra el código opaco de Order', async () => {
    const tree = await renderizarQr();

    expect(mockObtenerCompra).toHaveBeenCalledWith('compra-1');
    expect(mockObtenerOrden).not.toHaveBeenCalled();
    expect(mockObtenerQrRetiro).toHaveBeenCalledWith('orden-1');
    expect(tree.root.findAllByProps({ value: QR.codigo }).length).toBeGreaterThan(0);
    expect(() => tree.root.findByProps({ testID: 'qr-retiro-sin-qr' })).toThrow();

    desmontar(tree);
  });

  it('acepta ordenId directo y conserva el enlace a la boleta con el estado real', async () => {
    mockUseLocalSearchParams.mockReturnValue({ ordenId: 'orden-1' });

    const tree = await renderizarQr();

    expect(mockObtenerOrden).toHaveBeenCalledWith('orden-1');
    expect(mockObtenerCompra).not.toHaveBeenCalled();

    await pulsar(tree, 'abrir-boleta');
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/orden/[id]',
      params: { id: 'orden-1', estado: 'listo_para_retiro' },
    });

    desmontar(tree);
  });

  it('si Order no habilita el QR no muestra ninguno y ofrece el seguimiento', async () => {
    mockObtenerQrRetiro.mockRejectedValue(new ApiError('QR no disponible', 409));

    const tree = await renderizarQr();

    expect(() => tree.root.findByProps({ testID: 'qr-retiro-codigo' })).toThrow();
    expect(tree.root.findByProps({ testID: 'qr-retiro-sin-qr' })).toBeDefined();

    await pulsar(tree, 'qr-retiro-ver-seguimiento');
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/seguimientos',
      params: { compraId: 'compra-1', ordenId: 'orden-1' },
    });

    desmontar(tree);
  });

  it('vuelve a consultar el QR cada vez que gana foco', async () => {
    const tree = await renderizarQr();

    const llamadas = mockUseFocusEffect.mock.calls;
    const callback = llamadas[llamadas.length - 1][0];
    await act(async () => {
      callback();
    });

    expect(mockObtenerQrRetiro).toHaveBeenCalledTimes(2);

    desmontar(tree);
  });

  it('sin compraId ni ordenId no ofrece boleta ni QR', async () => {
    mockUseLocalSearchParams.mockReturnValue({});

    const tree = await renderizarQr();

    expect(mockObtenerCompra).not.toHaveBeenCalled();
    expect(mockObtenerOrden).not.toHaveBeenCalled();
    expect(mockObtenerQrRetiro).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ testID: 'abrir-boleta' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'qr-retiro-codigo' })).toHaveLength(0);

    desmontar(tree);
  });
});
