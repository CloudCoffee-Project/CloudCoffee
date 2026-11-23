// src/__tests__/cliente-qr-retiro.test.tsx
// INT4-128 + INT4-103: la pantalla muestra el código opaco que devuelve Order y
// lo serializa en el QR que consume el cajero. Sin código válido del backend,
// degrada y no ofrece un QR que pueda registrarse como entrega.
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import QrRetiroScreen from '../app/(cliente)/qr-retiro';
import { TITULO_ERROR_BACKEND } from '../components/ErrorBackend';
import { obtenerCompra } from '../services/compras';
import { ApiError } from '../services/httpClient';
import { obtenerOrden, obtenerQrRetiro } from '../services/ordenes';
import { serializarQrRetiro } from '../services/qrRetiro';
import { desmontar, limpiarRouter, pulsar, routerMock, texto } from '../test-utils';
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

const CODIGO = 'A'.repeat(43);

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
  codigo: CODIGO,
  expiraAt: '2026-01-01T01:00:00Z',
};

const QR_VALUE = serializarQrRetiro({
  pedido: QR.ordenId,
  estado: 'listo_para_retiro',
  codigo: CODIGO,
});

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
  it('resuelve la orden desde compraId y muestra el código opaco de Order en el QR', async () => {
    const tree = await renderizarQr();

    expect(mockObtenerCompra).toHaveBeenCalledWith('compra-1');
    expect(mockObtenerOrden).not.toHaveBeenCalled();
    expect(mockObtenerQrRetiro).toHaveBeenCalledWith('orden-1');
    expect(tree.root.findAllByProps({ value: QR_VALUE }).length).toBeGreaterThan(0);
    expect(() => tree.root.findByProps({ testID: 'qr-retiro-sin-qr' })).toThrow();
    expect(tree.root.findAllByProps({ testID: 'cliente-qr-sin-codigo' })).toHaveLength(0);

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

  it('si Order no habilita el QR degrada y ofrece el seguimiento', async () => {
    mockObtenerQrRetiro.mockRejectedValue(new ApiError('QR no disponible', 409));

    const tree = await renderizarQr();

    expect(() => tree.root.findByProps({ testID: 'qr-retiro-codigo' })).toThrow();
    expect(tree.root.findByProps({ testID: 'qr-retiro-sin-qr' })).toBeDefined();
    expect(texto(tree, 'cliente-qr-sin-codigo')).toContain('todavía no está disponible');

    await pulsar(tree, 'qr-retiro-ver-seguimiento');
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/seguimientos',
      params: { compraId: 'compra-1', ordenId: 'orden-1' },
    });

    desmontar(tree);
  });

  it('INT4-132: un fallo de la orden muestra el error común y permite reintentar', async () => {
    mockObtenerCompra
      .mockRejectedValueOnce(new ApiError('Order no responde.', 503))
      .mockResolvedValueOnce(COMPRA);

    const tree = await renderizarQr();

    expect(texto(tree, 'qr-retiro-error-titulo')).toBe(TITULO_ERROR_BACKEND);
    expect(texto(tree, 'qr-retiro-error-mensaje')).toBe('Order no responde.');
    expect(() => tree.root.findByProps({ testID: 'qr-retiro-cargando' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'qr-retiro-reintentar' })).not.toThrow();

    await pulsar(tree, 'qr-retiro-reintentar');

    expect(mockObtenerCompra).toHaveBeenCalledTimes(2);
    expect(mockObtenerQrRetiro).toHaveBeenCalledWith('orden-1');
    expect(tree.root.findAllByProps({ testID: 'qr-retiro-codigo' }).length).toBeGreaterThan(0);

    desmontar(tree);
  });

  it('INT4-132: timeout al pedir el QR es error, no una degradación silenciosa', async () => {
    mockObtenerQrRetiro.mockRejectedValue(new ApiError('Network Error', 0));

    const tree = await renderizarQr();

    expect(texto(tree, 'qr-retiro-error-titulo')).toBe(TITULO_ERROR_BACKEND);
    expect(texto(tree, 'qr-retiro-error-mensaje')).toBe('Network Error');
    expect(() => tree.root.findByProps({ testID: 'qr-retiro-sin-qr' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'qr-retiro-reintentar' })).not.toThrow();

    desmontar(tree);
  });

  it('no muestra un QR registrable si el código del backend no cumple el contrato', async () => {
    mockObtenerQrRetiro.mockResolvedValue({ ...QR, codigo: 'codigo-corto' });

    const tree = await renderizarQr();

    expect(tree.root.findAllByProps({ testID: 'qr-retiro-codigo' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'qr-retiro-sin-qr' })).toBeDefined();
    expect(texto(tree, 'cliente-qr-sin-codigo')).toContain('todavía no está disponible');

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
