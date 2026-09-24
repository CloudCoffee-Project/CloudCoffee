// src/__tests__/cajero-pedidos.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';

import PedidosEntrantesScreen, { buscarOrdenPorCodigo } from '../app/(cajero)/index';
import { fetchPedidosEntrantes } from '../services/ordenes';
import { getAccessToken } from '../services/httpClient';
import { useOrdenEstado } from '../hooks/useOrdenEstado';
import type { Orden } from '../types/domain';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: mockReplace })),
}));

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

const ordenesMock: Orden[] = [
  {
    ordenId: 'o-1',
    codigoOrden: 'CC-9801',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Ignacio Soto',
    estado: 'pagado',
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
        ordenItemId: 'itm-3',
        productoNombre: 'Jugo Natural Naranja 300ml',
        cantidad: 2,
        precioUnitario: 2000,
      },
    ],
  },
];

// Cubre los valores del union EstadoOrden para probar los filtros básicos
// "Activos" (reservando, pagado, listo_para_retiro) y "No retirados".
const ordenesFiltrosMock: Orden[] = [
  ...ordenesMock,
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
        ordenItemId: 'itm-4',
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
        ordenItemId: 'itm-5',
        productoNombre: 'Jugo Natural Naranja 300ml',
        cantidad: 1,
        precioUnitario: 2000,
      },
    ],
  },
  {
    ordenId: 'o-5',
    codigoOrden: 'CC-9805',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Luis Torres',
    estado: 'reservando',
    montoTotal: 1800,
    items: [
      {
        ordenItemId: 'itm-6',
        productoNombre: 'Café Americano 12oz',
        cantidad: 1,
        precioUnitario: 1800,
      },
    ],
  },
  {
    ordenId: 'o-6',
    codigoOrden: 'CC-9806',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'María Lagos',
    estado: 'cancelado',
    montoTotal: 3000,
    items: [
      {
        ordenItemId: 'itm-7',
        productoNombre: 'Sándwich Ave Palta',
        cantidad: 1,
        precioUnitario: 3000,
      },
    ],
  },
  {
    ordenId: 'o-7',
    codigoOrden: 'CC-9807',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Javiera Rojas',
    estado: 'listo_para_retiro',
    montoTotal: 2400,
    items: [
      {
        ordenItemId: 'itm-8',
        productoNombre: 'Croissant Jamón y Queso',
        cantidad: 1,
        precioUnitario: 2400,
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

async function renderizarPedidos(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<PedidosEntrantesScreen />);
    // Permite que resuelvan las promesas del fetch inicial dentro del act.
    await Promise.resolve();
  });
  return tree;
}

describe('Pantalla de pedidos del cajero', () => {
  beforeEach(() => {
    mockGetAccessToken.mockReset();
    mockFetchPedidos.mockReset();
    (useOrdenEstado as unknown as jest.Mock).mockReturnValue(null);
  });

  it('carga las órdenes con el token real y muestra la cola de activos por defecto', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarPedidos();

    expect(mockGetAccessToken).toHaveBeenCalled();
    expect(mockFetchPedidos).toHaveBeenCalledWith('token-real');
    // Por defecto el listado es "Activos" (reservando + pagado): el
    // pedido entregado queda fuera de la cola.
    expect(dataDe(tree)).toEqual([ordenesMock[0]]);

    const chipTodos = tree.root.findByProps({ testID: 'cajero-filtro-todos' });
    await act(async () => {
      chipTodos.props.onPress();
    });
    expect(dataDe(tree)).toEqual(ordenesMock);

    act(() => tree.unmount());
  }, 20000);

  it('muestra el error de la API con toApiError', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockRejectedValue(new Error('Request failed with status code 503'));

    const tree = await renderizarPedidos();

    const banner = tree.root.findByProps({ testID: 'cajero-error' });
    expect(textoDe(banner)).toContain('503');

    act(() => tree.unmount());
  });

  it('muestra el estado vacío cuando no hay pedidos', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue([]);

    const tree = await renderizarPedidos();

    const vacio = tree.root.findByProps({ testID: 'cajero-vacio' });
    expect(textoDe(vacio)).toContain('No hay pedidos pendientes');

    act(() => tree.unmount());
  });

  it('no rompe sin token: delega el error a la API', async () => {
    mockGetAccessToken.mockReturnValue(null);
    mockFetchPedidos.mockRejectedValue(new Error('Request failed with status code 401'));

    const tree = await renderizarPedidos();

    expect(mockFetchPedidos).toHaveBeenCalledWith('');
    const banner = tree.root.findByProps({ testID: 'cajero-error' });
    expect(textoDe(banner)).toContain('401');

    act(() => tree.unmount());
  });

  it('filtra por estado usando valores del union EstadoOrden', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarPedidos();

    const chipPagado = tree.root.findByProps({ testID: 'cajero-chip-🔵 Pagado (1)' });
    await act(async () => {
      chipPagado.props.onPress();
    });

    expect(dataDe(tree)).toEqual([ordenesMock[0]]);

    act(() => tree.unmount());
  }, 20000);

  it('filtra por búsqueda de folio o cliente', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarPedidos();

    // El pedido o-2 está entregado, así que primero salimos de "Activos".
    const chipTodos = tree.root.findByProps({ testID: 'cajero-filtro-todos' });
    await act(async () => {
      chipTodos.props.onPress();
    });

    const buscador = tree.root.findByProps({ testID: 'cajero-buscador' });
    await act(async () => {
      buscador.props.onChangeText('CC-9802');
    });

    expect(dataDe(tree)).toEqual([ordenesMock[1]]);

    act(() => tree.unmount());
  }, 20000);

  it('filtra por las categorías básicas de activos y no retirados', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesFiltrosMock);

    const tree = await renderizarPedidos();

    // Cola por defecto: solo activos (reservando, pagado, listo_para_retiro).
    expect(dataDe(tree)).toEqual([
      ordenesFiltrosMock[0],
      ordenesFiltrosMock[4],
      ordenesFiltrosMock[6],
    ]);

    const chipNoRetirados = tree.root.findByProps({ testID: 'cajero-filtro-no-retirados' });
    await act(async () => {
      chipNoRetirados.props.onPress();
    });
    expect(dataDe(tree)).toEqual([ordenesFiltrosMock[2], ordenesFiltrosMock[3]]);

    const chipActivos = tree.root.findByProps({ testID: 'cajero-filtro-activos' });
    await act(async () => {
      chipActivos.props.onPress();
    });
    expect(dataDe(tree)).toEqual([
      ordenesFiltrosMock[0],
      ordenesFiltrosMock[4],
      ordenesFiltrosMock[6],
    ]);

    const chipTodos = tree.root.findByProps({ testID: 'cajero-filtro-todos' });
    await act(async () => {
      chipTodos.props.onPress();
    });
    expect(dataDe(tree)).toEqual(ordenesFiltrosMock);

    act(() => tree.unmount());
  }, 20000);

  it('muestra mensaje específico cuando no hay pedidos activos', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue([ordenesMock[1]]);

    const tree = await renderizarPedidos();

    const vacio = tree.root.findByProps({ testID: 'cajero-vacio' });
    expect(textoDe(vacio)).toContain('No hay pedidos activos');

    act(() => tree.unmount());
  });
});

describe('Búsqueda manual por código de orden (INT4-10)', () => {
  beforeEach(() => {
    mockGetAccessToken.mockReset();
    mockFetchPedidos.mockReset();
    mockReplace.mockReset();
    (useOrdenEstado as unknown as jest.Mock).mockReturnValue(null);
  });

  it('encuentra la orden por folio corto ignorando mayúsculas y espacios', () => {
    expect(buscarOrdenPorCodigo(ordenesMock, '  cc-9801 ')).toEqual({
      tipo: 'exito',
      orden: ordenesMock[0],
    });
  });

  it('encuentra la orden por su id', () => {
    expect(buscarOrdenPorCodigo(ordenesMock, 'O-1')).toEqual({
      tipo: 'exito',
      orden: ordenesMock[0],
    });
  });

  it('reporta cuando el folio no existe', () => {
    expect(buscarOrdenPorCodigo(ordenesMock, 'CC-9999')).toEqual({
      tipo: 'no_encontrada',
      codigo: 'CC-9999',
    });
  });

  it('rechaza órdenes ya entregadas y canceladas', () => {
    expect(buscarOrdenPorCodigo(ordenesMock, 'CC-9802')).toEqual({
      tipo: 'ya_entregada',
      codigo: 'CC-9802',
    });
    expect(buscarOrdenPorCodigo(ordenesFiltrosMock, 'CC-9806')).toEqual({
      tipo: 'cancelada',
      codigo: 'CC-9806',
    });
  });

  it('pide un folio cuando el campo está vacío', () => {
    expect(buscarOrdenPorCodigo(ordenesMock, '   ')).toEqual({ tipo: 'vacia' });
  });

  it('valida el folio y navega a la confirmación de entrega con pedido y estado', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarPedidos();

    const input = tree.root.findByProps({ testID: 'cajero-folio-input' });
    await act(async () => {
      input.props.onChangeText('cc-9801');
    });
    const validar = tree.root.findByProps({ testID: 'cajero-folio-validar' });
    await act(async () => {
      validar.props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(cajero)/confirmacion-entrega',
      params: { pedido: 'o-1', estado: 'pagado' },
    });

    act(() => tree.unmount());
  }, 20000);

  it('muestra el error del mockup cuando el folio no existe', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarPedidos();

    const input = tree.root.findByProps({ testID: 'cajero-folio-input' });
    await act(async () => {
      input.props.onChangeText('CC-9999');
    });
    const validar = tree.root.findByProps({ testID: 'cajero-folio-validar' });
    await act(async () => {
      validar.props.onPress();
    });

    const errorBanner = tree.root.findByProps({ testID: 'cajero-folio-error' });
    expect(textoDe(errorBanner)).toContain(
      'No se encontró ninguna orden con el código/folio: CC-9999'
    );

    act(() => tree.unmount());
  }, 20000);

  it('pide el folio cuando el campo está vacío desde la pantalla', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarPedidos();

    const validar = tree.root.findByProps({ testID: 'cajero-folio-validar' });
    await act(async () => {
      validar.props.onPress();
    });

    const errorBanner = tree.root.findByProps({ testID: 'cajero-folio-error' });
    expect(textoDe(errorBanner)).toContain('Ingresa el folio o el código de la orden.');

    act(() => tree.unmount());
  }, 20000);

  it('rechaza una orden ya entregada desde la pantalla', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarPedidos();

    const input = tree.root.findByProps({ testID: 'cajero-folio-input' });
    await act(async () => {
      input.props.onChangeText('CC-9802');
    });
    const validar = tree.root.findByProps({ testID: 'cajero-folio-validar' });
    await act(async () => {
      validar.props.onPress();
    });

    const errorBanner = tree.root.findByProps({ testID: 'cajero-folio-error' });
    expect(textoDe(errorBanner)).toContain('Esta orden ya fue entregada.');
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => tree.unmount());
  }, 20000);
});
