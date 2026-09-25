// src/__tests__/cajero-escaner.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import EscanerQRScreen, { procesarCodigo } from '../app/(cajero)/escaner';
import { fetchPedidosEntrantes } from '../services/ordenes';
import { getAccessToken } from '../services/httpClient';
import { serializarQrRetiro } from '../services/qrRetiro';
import { useIsFocused } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import type { Orden, QrRetiro } from '../types/domain';

const mockReplace = jest.fn();

jest.mock('../services/ordenes', () => ({
  fetchPedidosEntrantes: jest.fn(),
}));

jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn() };
});

jest.mock('expo-router', () => ({
  useIsFocused: jest.fn(() => true),
  useRouter: jest.fn(() => ({ replace: mockReplace })),
  useFocusEffect: jest.fn(),
}));

// expo-camera es un módulo nativo: en los tests se reemplaza por un View que
// expone onBarcodeScanned para simular un escaneo, y el permiso queda mockeado.
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    useCameraPermissions: jest.fn(),
    CameraView: (props: {
      testID?: string;
      onBarcodeScanned?: (resultado: { data: string }) => void;
      barcodeScannerSettings?: { barcodeTypes: string[] };
    }) =>
      React.createElement(View, {
        testID: props.testID ?? 'cajero-camara',
        onBarcodeScanned: props.onBarcodeScanned,
        barcodeScannerSettings: props.barcodeScannerSettings,
      }),
  };
});

const mockFetchPedidos = fetchPedidosEntrantes as unknown as jest.Mock;
const mockGetAccessToken = getAccessToken as unknown as jest.Mock;
const mockUseIsFocused = useIsFocused as unknown as jest.Mock;
const mockUseCameraPermissions = useCameraPermissions as unknown as jest.Mock;

const payloadValido: QrRetiro = { pedido: 'o-1', estado: 'listo_para_retiro' };
const contenidoValido = serializarQrRetiro(payloadValido);

const ordenEntregable: Orden = {
  ordenId: 'o-1',
  codigoOrden: 'CC-9801',
  cafeteriaId: 'c-1',
  cafeteriaNombre: 'Cafetería Central',
  clienteNombre: 'Ignacio Soto',
  estado: 'listo_para_retiro',
  montoTotal: 4300,
  items: [
    {
      ordenItemId: 'itm-1',
      productoNombre: 'Café Americano 12oz',
      cantidad: 1,
      precioUnitario: 1800,
    },
    {
      ordenItemId: 'itm-2',
      productoNombre: 'Croissant Jamón y Queso',
      cantidad: 1,
      precioUnitario: 2500,
    },
  ],
};

const ordenYaEntregada: Orden = {
  ...ordenEntregable,
  codigoOrden: 'CC-9802',
  estado: 'entregado',
};

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

async function renderizarEscaner(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<EscanerQRScreen />);
    // Permite que resuelvan las promesas del fetch inicial dentro del act.
    await Promise.resolve();
  });
  return tree;
}

async function escanear(tree: ReactTestRenderer, contenido: string): Promise<void> {
  const camara = tree.root.findByProps({ testID: 'cajero-camara' });
  await act(async () => {
    camara.props.onBarcodeScanned({ data: contenido });
  });
}

describe('procesarCodigo (validación del QR sin cámara)', () => {
  it('valida el payload de un QR de retiro', () => {
    const resultado = procesarCodigo(contenidoValido, []);

    expect(resultado.tipo).toBe('exito');
    if (resultado.tipo === 'exito') {
      expect(resultado.payload).toEqual(payloadValido);
      expect(resultado.orden).toBeUndefined();
    }
  });

  it('rechaza un QR de una orden ya entregada usar el estado del payload', () => {
    const resultado = procesarCodigo(
      serializarQrRetiro({ pedido: 'o-9', estado: 'entregado' }),
      []
    );

    expect(resultado.tipo).toBe('error');
    if (resultado.tipo === 'error') {
      expect(resultado.mensaje).toContain('ya fue utilizado');
    }
  });

  it('rechaza el QR aunque el payload diga otro estado si la orden ya está entregada', () => {
    const resultado = procesarCodigo(contenidoValido, [ordenYaEntregada]);

    expect(resultado.tipo).toBe('error');
    if (resultado.tipo === 'error') {
      expect(resultado.mensaje).toContain('ya fue utilizado');
    }
  });

  it('rechaza un QR cancelado en el listado', () => {
    const resultado = procesarCodigo(contenidoValido, [
      { ...ordenEntregable, codigoOrden: 'CC-9803', estado: 'cancelado' },
    ]);

    expect(resultado.tipo).toBe('error');
    if (resultado.tipo === 'error') {
      expect(resultado.mensaje).toContain('cancelado');
    }
  });

  it('rechaza contenido que no es un QR de retiro válido', () => {
    const resultado = procesarCodigo('texto-plano', []);

    expect(resultado.tipo).toBe('error');
  });
});

describe('Pantalla de escaneo de QR (cajero)', () => {
  const requestPermission = jest.fn();

  beforeEach(() => {
    mockGetAccessToken.mockReset();
    mockFetchPedidos.mockReset();
    requestPermission.mockReset();
    mockReplace.mockClear();
    mockUseIsFocused.mockReturnValue(true);
    mockUseCameraPermissions.mockReset();
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, requestPermission]);
  });

  it('muestra la cámara y escanea solo códigos QR', async () => {
    mockFetchPedidos.mockResolvedValue([ordenEntregable]);
    const tree = await renderizarEscaner();

    const camara = tree.root.findByProps({ testID: 'cajero-camara' });
    expect(camara).toBeTruthy();
    expect(camara.props.barcodeScannerSettings).toEqual({ barcodeTypes: ['qr'] });

    act(() => tree.unmount());
  });

  it('navega a la pantalla de confirmación de entrega tras un QR válido', async () => {
    mockFetchPedidos.mockResolvedValue([ordenEntregable]);
    mockGetAccessToken.mockReturnValue('token-real');

    const tree = await renderizarEscaner();
    await escanear(tree, contenidoValido);

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(cajero)/confirmacion-entrega',
      params: { pedido: 'o-1', estado: 'listo_para_retiro' },
    });

    act(() => tree.unmount());
  });

  it('rechaza un QR ya utilizado y permite volver a escanear', async () => {
    mockFetchPedidos.mockResolvedValue([ordenYaEntregada]);
    const tree = await renderizarEscaner();

    await escanear(tree, contenidoValido);

    const error = tree.root.findByProps({ testID: 'cajero-escaner-error' });
    expect(textoDe(error)).toContain('ya fue utilizado');

    const reintentar = tree.root.findByProps({ testID: 'cajero-escaner-reintentar' });
    await act(async () => {
      reintentar.props.onPress();
    });
    tree.root.findByProps({ testID: 'cajero-camara' });

    act(() => tree.unmount());
  });

  it('pide el permiso de cámara cuando está denegado', async () => {
    mockUseCameraPermissions.mockReturnValue([
      { granted: false, canAskAgain: true },
      requestPermission,
    ]);
    const tree = await renderizarEscaner();

    tree.root.findByProps({ testID: 'cajero-escaner-permiso' });

    const pedir = tree.root.findByProps({ testID: 'cajero-escaner-pedir-permiso' });
    await act(async () => {
      pedir.props.onPress();
    });
    expect(requestPermission).toHaveBeenCalled();

    act(() => tree.unmount());
  });

  it('no mantiene la cámara activa cuando la pestaña pierde el foco', async () => {
    mockUseIsFocused.mockReturnValue(false);
    mockFetchPedidos.mockResolvedValue([ordenEntregable]);
    const tree = await renderizarEscaner();

    tree.root.findByProps({ testID: 'cajero-escaner-inactivo' });
    expect(tree.root.findAllByProps({ testID: 'cajero-camara' })).toHaveLength(0);

    act(() => tree.unmount());
  });
});
