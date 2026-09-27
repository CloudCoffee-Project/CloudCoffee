// src/__tests__/cajero-confirmacion-entrega.test.tsx
//
// Tests de la pantalla de confirmación de entrega (INT4-9): detalle de ítems
// a entregar tras validar el QR. Se mockean los servicios (listado + entrega)
// igual que en cajero-escaner.test.tsx.

import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import ConfirmacionEntregaScreen from '../app/(cajero)/confirmacion-entrega';
import { fetchPedidosEntrantes, marcarOrdenEntregada } from '../services/ordenes';
import { getAccessToken } from '../services/httpClient';
import type { Orden } from '../types/domain';

const mockReplace = jest.fn();
const mockParams: { pedido?: string; estado?: string } = {
  pedido: 'o-1',
  estado: 'listo_para_retiro',
};

jest.mock('../services/ordenes', () => ({
  fetchPedidosEntrantes: jest.fn(),
  marcarOrdenEntregada: jest.fn(),
}));

jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn() };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => mockParams),
  useRouter: jest.fn(() => ({ replace: mockReplace })),
}));

const mockFetchPedidos = fetchPedidosEntrantes as unknown as jest.Mock;
const mockMarcarEntregada = marcarOrdenEntregada as unknown as jest.Mock;
const mockGetAccessToken = getAccessToken as unknown as jest.Mock;

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

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

async function renderizarConfirmacion(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ConfirmacionEntregaScreen />);
    // Permite que resuelvan las promesas del fetch inicial dentro del act.
    await Promise.resolve();
  });
  return tree;
}

describe('Pantalla de confirmación de entrega (INT4-9)', () => {
  beforeEach(() => {
    mockGetAccessToken.mockReset();
    mockFetchPedidos.mockReset();
    mockMarcarEntregada.mockReset();
    mockReplace.mockClear();
    mockParams.pedido = 'o-1';
    mockParams.estado = 'listo_para_retiro';
  });

  it('muestra el detalle de ítems a entregar (cliente, checklist y total)', async () => {
    mockFetchPedidos.mockResolvedValue([ordenEntregable]);
    mockGetAccessToken.mockReturnValue('token-real');

    const tree = await renderizarConfirmacion();

    const detalle = tree.root.findByProps({ testID: 'cajero-confirmacion-detalle' });
    expect(textoDe(detalle)).toContain('QR Validado Correctamente');
    expect(textoDe(detalle)).toContain('#o-1');
    expect(textoDe(detalle)).toContain('Ignacio Soto');
    expect(textoDe(detalle)).toContain('1xCafé Americano 12oz');
    expect(textoDe(detalle)).toContain('1xCroissant Jamón y Queso');
    expect(textoDe(detalle)).toContain('Total pagado');
    expect(textoDe(detalle)).toContain('$4.300');

    act(() => tree.unmount());
  });

  it('confirma la entrega contra el endpoint real y muestra la confirmación', async () => {
    mockFetchPedidos.mockResolvedValue([ordenEntregable]);
    mockGetAccessToken.mockReturnValue('token-real');
    mockMarcarEntregada.mockResolvedValue({ ...ordenEntregable, estado: 'entregado' });

    const tree = await renderizarConfirmacion();

    const confirmar = tree.root.findByProps({ testID: 'cajero-confirmacion-confirmar' });
    await act(async () => {
      confirmar.props.onPress();
      await Promise.resolve();
    });

    expect(mockMarcarEntregada).toHaveBeenCalledWith('o-1', 'token-real');
    const entregada = tree.root.findByProps({ testID: 'cajero-confirmacion-entregada' });
    expect(textoDe(entregada)).toContain('Entrega registrada');

    act(() => tree.unmount());
  });

  it('muestra el error normalizado si el endpoint de entrega falla', async () => {
    mockFetchPedidos.mockResolvedValue([ordenEntregable]);
    mockGetAccessToken.mockReturnValue('token-real');
    mockMarcarEntregada.mockRejectedValue({
      message: 'Request failed with status code 409',
      response: { status: 409, data: { detail: 'La orden ya fue entregada.' } },
    });

    const tree = await renderizarConfirmacion();

    const confirmar = tree.root.findByProps({ testID: 'cajero-confirmacion-confirmar' });
    await act(async () => {
      confirmar.props.onPress();
      await Promise.resolve();
    });

    const banner = tree.root.findByProps({ testID: 'cajero-confirmacion-error-entrega' });
    expect(textoDe(banner)).toContain('La orden ya fue entregada.');

    act(() => tree.unmount());
  });

  it('muestra solo el N° de pedido si el listado no responde', async () => {
    mockFetchPedidos.mockRejectedValue(new Error('gateway sin /v1/orders'));
    mockGetAccessToken.mockReturnValue('token-real');

    const tree = await renderizarConfirmacion();

    const detalle = tree.root.findByProps({ testID: 'cajero-confirmacion-detalle' });
    expect(textoDe(detalle)).toContain('#o-1');
    expect(textoDe(detalle)).not.toContain('Ignacio Soto');
    expect(textoDe(detalle)).not.toContain('Total pagado');
    // El botón de confirmar sigue disponible para entregar igualmente.
    expect(tree.root.findAllByProps({ testID: 'cajero-confirmacion-confirmar' })).not.toHaveLength(
      0
    );

    act(() => tree.unmount());
  });

  it('con params inválidos muestra el QR como no válido y vuelve al escáner', async () => {
    delete mockParams.pedido;
    mockParams.estado = 'entregado';

    const tree = await renderizarConfirmacion();

    const invalida = tree.root.findByProps({ testID: 'cajero-confirmacion-invalida' });
    expect(textoDe(invalida)).toContain('QR no válido');

    const volver = tree.root.findByProps({ testID: 'cajero-confirmacion-volver-escaner' });
    await act(async () => {
      volver.props.onPress();
    });
    expect(mockReplace).toHaveBeenCalledWith('/(cajero)/escaner');

    act(() => tree.unmount());
  });

  it('con un estado fuera del union también lo trata como QR no válido', async () => {
    mockParams.pedido = 'o-1';
    mockParams.estado = 'estado-inventado';

    const tree = await renderizarConfirmacion();

    tree.root.findByProps({ testID: 'cajero-confirmacion-invalida' });

    act(() => tree.unmount());
  });
});
