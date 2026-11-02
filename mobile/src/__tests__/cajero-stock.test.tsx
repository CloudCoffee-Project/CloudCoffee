// src/__tests__/cajero-stock.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';
import { useFocusEffect } from 'expo-router';

import StockScreen from '../app/(cajero)/stock';
import { useCafeteriaStock } from '../hooks/useCafeteriaStock';
import { listarInventarioCafeteria, obtenerNombreCafeteria } from '../services/inventario';
import { desmontar, promesaPendiente, textoDe } from '../test-utils';
import type { InventarioItem } from '../types/domain';

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

jest.mock('../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    sesion: {
      userId: 'user-1',
      rol: 'cajero',
      cafeteriaId: 'cafe-1',
      exp: 0,
    },
    bootstrapping: false,
    iniciarSesion: jest.fn(),
    cerrarSesion: jest.fn(),
  })),
}));

jest.mock('../services/inventario', () => ({
  listarInventarioCafeteria: jest.fn(),
  obtenerNombreCafeteria: jest.fn(),
}));

jest.mock('../hooks/useCafeteriaStock', () => ({
  useCafeteriaStock: jest.fn(() => ({})),
}));

const mockListar = listarInventarioCafeteria as unknown as jest.Mock;
const mockNombre = obtenerNombreCafeteria as unknown as jest.Mock;
const mockUseCafeteriaStock = useCafeteriaStock as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;

const inventarioMock: InventarioItem[] = [
  {
    ofertaId: 'of-1',
    productoId: 'prod-1',
    productoNombre: 'Café americano',
    precio: 1500,
    stock: 40,
    estado: 'AVAILABLE',
  },
  {
    ofertaId: 'of-2',
    productoId: 'prod-2',
    productoNombre: 'Latte de vainilla',
    precio: 2600,
    stock: 0,
    estado: 'AVAILABLE',
  },
  {
    ofertaId: 'of-3',
    productoId: 'prod-3',
    productoNombre: 'Agua mineral',
    precio: 1000,
    stock: 0,
    estado: 'OUT_OF_STOCK',
  },
];

let arbolActual: ReactTestRenderer | null = null;

function dataDe(tree: ReactTestRenderer): InventarioItem[] {
  return tree.root.findByType(FlatList).props.data as InventarioItem[];
}

// Monta la pantalla y ejecuta el callback que capturó el mock de
// useFocusEffect (equivale a que la pestaña gane foco y cargue el stock).
async function renderStock(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<StockScreen />);
  });
  arbolActual = tree;

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0] as () => void;
  await act(async () => {
    callback();
  });

  return tree;
}

beforeEach(() => {
  mockListar.mockReset();
  mockNombre.mockReset();
  mockUseCafeteriaStock.mockReset();
  mockUseFocusEffect.mockReset();
  mockListar.mockResolvedValue(inventarioMock);
  mockNombre.mockResolvedValue('Cafetería Central');
  mockUseCafeteriaStock.mockReturnValue({});
});

afterEach(() => {
  if (arbolActual !== null) {
    desmontar(arbolActual);
    arbolActual = null;
  }
});

describe('Pantalla de stock del cajero', () => {
  it('carga el inventario real y muestra el nombre de la cafetería', async () => {
    const tree = await renderStock();

    expect(mockListar).toHaveBeenCalledWith('cafe-1');
    expect(mockNombre).toHaveBeenCalledWith('cafe-1');
    expect(dataDe(tree)).toEqual(inventarioMock);
    expect(textoDe(tree.root)).toContain('Stock · Cafetería Central');
  }, 20000);

  it('cuenta disponibles y agotados con el stock del backend', async () => {
    const tree = await renderStock();

    expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-chip-todos' }))).toBe('Todos (3)');
    expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-chip-disponibles' }))).toBe(
      'Disponibles (1)'
    );
    expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-chip-agotados' }))).toBe(
      'Agotados (2)'
    );
  }, 20000);

  it('filtra por agotados y disponibles', async () => {
    const tree = await renderStock();

    await act(async () => {
      tree.root.findByProps({ testID: 'cajero-stock-chip-agotados' }).props.onPress();
    });
    expect(dataDe(tree)).toEqual([inventarioMock[1], inventarioMock[2]]);

    await act(async () => {
      tree.root.findByProps({ testID: 'cajero-stock-chip-disponibles' }).props.onPress();
    });
    expect(dataDe(tree)).toEqual([inventarioMock[0]]);
  }, 20000);

  it('busca por nombre de producto y muestra el vacío del mockup', async () => {
    const tree = await renderStock();

    await act(async () => {
      tree.root.findByProps({ testID: 'cajero-stock-buscador' }).props.onChangeText('americano');
    });
    expect(dataDe(tree)).toEqual([inventarioMock[0]]);

    await act(async () => {
      tree.root.findByProps({ testID: 'cajero-stock-buscador' }).props.onChangeText('zzz');
    });
    expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-vacio' }))).toContain(
      'No se encontraron productos que coincidan con la búsqueda.'
    );
  }, 20000);

  it('superpone el stock en vivo del WebSocket sin volver a pedir el inventario', async () => {
    mockUseCafeteriaStock.mockReturnValue({ 'of-2': 5 });

    const tree = await renderStock();

    expect(mockUseCafeteriaStock).toHaveBeenCalledWith('cafe-1');
    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(dataDe(tree)[1].stock).toBe(5);
    expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-badge-of-2' }))).toBe('5 un.');
    expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-chip-agotados' }))).toBe(
      'Agotados (1)'
    );
  }, 20000);

  it('muestra el esqueleto mientras carga', async () => {
    mockListar.mockReturnValue(promesaPendiente<InventarioItem[]>());
    mockNombre.mockReturnValue(promesaPendiente<string | null>());

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<StockScreen />);
    });
    arbolActual = tree;

    expect(tree.root.findByProps({ testID: 'cajero-stock-esqueleto' })).toBeTruthy();
  }, 20000);

  it('muestra el error de la API y reintenta la carga', async () => {
    mockListar.mockRejectedValueOnce(new Error('Request failed with status code 503'));

    const tree = await renderStock();

    const banner = tree.root.findByProps({ testID: 'cajero-stock-error' });
    expect(textoDe(banner)).toContain('503');

    mockListar.mockResolvedValue(inventarioMock);
    await act(async () => {
      tree.root.findByProps({ testID: 'cajero-stock-reintentar' }).props.onPress();
    });

    expect(dataDe(tree)).toEqual(inventarioMock);
    expect(tree.root.findAllByProps({ testID: 'cajero-stock-error' })).toHaveLength(0);
  }, 20000);

  it('muestra un vacío propio cuando la cafetería no tiene ofertas', async () => {
    mockListar.mockResolvedValue([]);

    const tree = await renderStock();

    expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-vacio' }))).toContain(
      'No hay productos registrados en el stock de esta cafetería.'
    );
  }, 20000);
});
