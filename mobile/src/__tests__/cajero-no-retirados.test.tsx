// src/__tests__/cajero-no-retirados.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';

import NoRetiradosScreen from '../app/(cajero)/no-retirados';
import { fetchPedidosEntrantes } from '../services/ordenes';
import { getAccessToken } from '../services/httpClient';
import { useOrdenEstado } from '../hooks/useOrdenEstado';
import type { Orden } from '../types/domain';

jest.mock('../services/ordenes', () => ({
  fetchPedidosEntrantes: jest.fn(),
}));

jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn() };
});

jest.mock('../hooks/useOrdenEstado', () => ({
  useOrdenEstado: jest.fn(() => null),
}));

const mockGetAccessToken = getAccessToken as unknown as jest.Mock;
const mockFetchPedidos = fetchPedidosEntrantes as unknown as jest.Mock;
const mockUseOrdenEstado = useOrdenEstado as unknown as jest.Mock;

// Mezcla de estados: activos y entregado quedan fuera del listado (solo se
// muestran los estados no retirados del union EstadoOrden).
const ordenesMock: Orden[] = [
  {
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
    ],
  },
  {
    ordenId: 'o-2',
    codigoOrden: 'CC-9802',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Camila Vergara',
    estado: 'entregado',
    montoTotal: 4000,
    items: [
      {
        ordenItemId: 'itm-2',
        productoNombre: 'Jugo Natural Naranja 300ml',
        cantidad: 2,
        precioUnitario: 2000,
      },
    ],
  },
  {
    ordenId: 'o-3',
    codigoOrden: 'CC-9803',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Diego Morales',
    estado: 'no_retirado_pendiente_revision',
    montoTotal: 2500,
    items: [
      {
        ordenItemId: 'itm-3',
        productoNombre: 'Muffin Chocolate',
        cantidad: 2,
        precioUnitario: 1250,
      },
    ],
  },
  {
    ordenId: 'o-4',
    codigoOrden: 'CC-9804',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Ana Pérez',
    estado: 'no_retirado_final',
    montoTotal: 2000,
    items: [
      {
        ordenItemId: 'itm-4',
        productoNombre: 'Jugo Natural Naranja 300ml',
        cantidad: 1,
        precioUnitario: 2000,
      },
    ],
  },
];

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

function dataDe(tree: ReactTestRenderer): Orden[] {
  const lista = tree.root.findByType(FlatList);
  return lista.props.data as Orden[];
}

async function renderizarNoRetirados(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<NoRetiradosScreen />);
    // Permite que resuelvan las promesas del fetch inicial dentro del act.
    await Promise.resolve();
  });
  return tree;
}

describe('Listado de órdenes no retiradas del cajero (INT4-11)', () => {
  beforeEach(() => {
    mockGetAccessToken.mockReset();
    mockFetchPedidos.mockReset();
    mockUseOrdenEstado.mockReset();
    mockUseOrdenEstado.mockReturnValue(null);
  });

  it('carga las órdenes con el token real y muestra solo las no retiradas', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    expect(mockGetAccessToken).toHaveBeenCalled();
    expect(mockFetchPedidos).toHaveBeenCalledWith('token-real');
    // Quedan fuera los pedidos activos (listo_para_retiro) y entregados.
    expect(dataDe(tree)).toEqual([ordenesMock[2], ordenesMock[3]]);

    act(() => tree.unmount());
  }, 20000);

  it('filtra por las categorías "Revisión" y "Finales" del union EstadoOrden', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    expect(dataDe(tree)).toEqual([ordenesMock[2], ordenesMock[3]]);

    const chipRevision = tree.root.findByProps({ testID: 'cajero-nr-chip-revision' });
    await act(async () => {
      chipRevision.props.onPress();
    });
    expect(dataDe(tree)).toEqual([ordenesMock[2]]);

    const chipFinal = tree.root.findByProps({ testID: 'cajero-nr-chip-final' });
    await act(async () => {
      chipFinal.props.onPress();
    });
    expect(dataDe(tree)).toEqual([ordenesMock[3]]);

    const chipTodos = tree.root.findByProps({ testID: 'cajero-nr-chip-todos' });
    await act(async () => {
      chipTodos.props.onPress();
    });
    expect(dataDe(tree)).toEqual([ordenesMock[2], ordenesMock[3]]);

    act(() => tree.unmount());
  }, 20000);

  it('muestra el badge del estado en cada tarjeta', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    const rowRevision = tree.root.findByProps({ testID: 'cajero-no-retirado-o-3' });
    expect(textoDe(rowRevision)).toContain('No Retirado · Revisión');

    const rowFinal = tree.root.findByProps({ testID: 'cajero-no-retirado-o-4' });
    expect(textoDe(rowFinal)).toContain('No Retirado');

    act(() => tree.unmount());
  }, 20000);

  it('usa el estado en vivo (WebSocket) para la etiqueta de la tarjeta', async () => {
    // o-3 (base: pendiente de revisión) llega en vivo como no_retirado_final.
    mockUseOrdenEstado.mockImplementation((ordenId: string) =>
      ordenId === 'o-3' ? 'no_retirado_final' : null
    );
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    const rowRevision = tree.root.findByProps({ testID: 'cajero-no-retirado-o-3' });
    expect(textoDe(rowRevision)).toContain('No Retirado');
    expect(textoDe(rowRevision)).not.toContain('Revisión');

    act(() => tree.unmount());
  }, 20000);

  it('muestra el error de la API con toApiError', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockRejectedValue(new Error('Request failed with status code 503'));

    const tree = await renderizarNoRetirados();

    const banner = tree.root.findByProps({ testID: 'cajero-nr-error' });
    expect(textoDe(banner)).toContain('503');

    act(() => tree.unmount());
  });

  it('no rompe sin token: delega el error a la API', async () => {
    mockGetAccessToken.mockReturnValue(null);
    mockFetchPedidos.mockRejectedValue(new Error('Request failed with status code 401'));

    const tree = await renderizarNoRetirados();

    expect(mockFetchPedidos).toHaveBeenCalledWith('');
    const banner = tree.root.findByProps({ testID: 'cajero-nr-error' });
    expect(textoDe(banner)).toContain('401');

    act(() => tree.unmount());
  });

  it('muestra el estado vacío cuando no hay órdenes no retiradas', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue([]);

    const tree = await renderizarNoRetirados();

    const vacio = tree.root.findByProps({ testID: 'cajero-nr-vacio' });
    expect(textoDe(vacio)).toContain('No hay órdenes no retiradas');

    act(() => tree.unmount());
  });

  it('muestra el mensaje vacío específico para el chip de revisión', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue([ordenesMock[3]]);

    const tree = await renderizarNoRetirados();

    const chipRevision = tree.root.findByProps({ testID: 'cajero-nr-chip-revision' });
    await act(async () => {
      chipRevision.props.onPress();
    });

    const vacio = tree.root.findByProps({ testID: 'cajero-nr-vacio' });
    expect(textoDe(vacio)).toContain('No hay órdenes no retiradas pendientes de revisión.');

    act(() => tree.unmount());
  }, 20000);
});
