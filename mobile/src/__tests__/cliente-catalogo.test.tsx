// src/__tests__/cliente-catalogo.test.tsx
// Cubre el catálogo del cliente (INT4-28 categorías y productos, INT4-29
// búsqueda): carga desde el servicio, precio tomado de la Oferta de la
// cafetería del campus, estado de stock, filtrado por categoría, búsqueda
// tolerante a typos y error normalizado con reintento.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import CatalogoProductosScreen from '../app/(cliente)/index';
import { leerCampusSeleccionado, listarCategorias, listarProductos } from '../services/catalog';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '../services/httpClient';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

jest.mock('../services/catalog', () => ({
  leerCampusSeleccionado: jest.fn(),
  listarCategorias: jest.fn(),
  listarProductos: jest.fn(),
  ofertaDeCafeteria: jest.requireActual('../services/catalog').ofertaDeCafeteria,
}));

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
// La pantalla usa ofertaDeCafeteria real, así que el servicio se carga con
// requireActual y arrastra su import de AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockRouter = { push: jest.fn() };

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: (props: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(View, props, props.children),
  };
});

const mockLeerCampus = leerCampusSeleccionado as unknown as jest.Mock;
const mockListarCategorias = listarCategorias as unknown as jest.Mock;
const mockListarProductos = listarProductos as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;

const campusMock: Campus = {
  id: 'san-juan-pablo-ii',
  nombre: 'Campus San Juan Pablo II',
  direccion: 'Peligde, Temuco',
};

const categoriasMock: Categoria[] = [
  { id: 'cat-bebidas', nombre: 'Bebidas' },
  { id: 'cat-pasteleria', nombre: 'Pastelería' },
];

function oferta(over: Partial<Oferta> = {}): Oferta {
  return {
    ofertaId: 'oferta-1',
    cafeteriaId: 'cafe-1',
    cafeteriaNombre: 'Cafetería Central',
    precio: 1800,
    stock: 4,
    disponible: true,
    ...over,
  };
}

function producto(id: string, over: Partial<Producto> = {}): Producto {
  return {
    id,
    nombre: `Producto ${id}`,
    descripcion: `Descripción ${id}`,
    categoriaId: 'cat-bebidas',
    // ofertaId derivado del producto para que cada fila tenga su propio testID.
    offers: [oferta({ ofertaId: `oferta-${id}` })],
    ...over,
  };
}

// Renderiza la pantalla y ejecuta el callback que el mock de useFocusEffect
// capturó (equivale a que la pantalla gane foco y cargue el catálogo).
function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

// Último árbol renderizado, para desmontarlo al final de cada test.
let arbolActual: ReactTestRenderer | null = null;

async function renderCatalogo(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<CatalogoProductosScreen />);
  });
  arbolActual = tree;

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });

  return tree;
}

// Los productos del campus por defecto (san-juan-pablo-ii -> cafe-1).
function productosBase(): Producto[] {
  return [
    producto('p-1', { nombre: 'Café Americano 12oz', descripcion: 'Espresso doble.' }),
    producto('p-2', {
      nombre: 'Croissant Jamón y Queso',
      descripcion: 'Hojaldre con queso gouda.',
      categoriaId: 'cat-pasteleria',
    }),
  ];
}

beforeEach(() => {
  mockLeerCampus.mockReset();
  mockListarCategorias.mockReset();
  mockListarProductos.mockReset();
  mockUseFocusEffect.mockReset();
  mockRouter.push.mockClear();
  mockLeerCampus.mockResolvedValue(campusMock);
  mockListarCategorias.mockResolvedValue(categoriasMock);
  mockListarProductos.mockResolvedValue(productosBase());
});

// Desmontar al terminar cada test: el FlatList agenda un timer interno de
// VirtualizedList que, si queda vivo, dispara un setState fuera de act().
afterEach(() => {
  if (arbolActual !== null) {
    act(() => arbolActual?.unmount());
    arbolActual = null;
  }
});

describe('Catálogo del cliente', () => {
  it('carga campus, categorías y productos del campus seleccionado', async () => {
    const tree = await renderCatalogo();

    expect(mockListarCategorias).toHaveBeenCalled();
    // El campus manda el filtro: sin categoría, solo campusId.
    expect(mockListarProductos).toHaveBeenCalledWith('san-juan-pablo-ii', undefined);
    expect(tree.root.findByProps({ testID: 'catalogo-lista' })).toBeTruthy();
  });

  it('muestra las categorías reales como pills, con TODOS primero', async () => {
    const tree = await renderCatalogo();

    expect(tree.root.findByProps({ testID: 'catalogo-chip-todos' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'catalogo-chip-cat-bebidas' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'catalogo-chip-cat-pasteleria' })).toBeTruthy();
  });

  it('muestra el precio de la oferta formateado en es-CL', async () => {
    const tree = await renderCatalogo();

    const precio = tree.root.findAll(
      (n: ReactTestInstance) =>
        typeof n.props.children === 'string' && n.props.children.startsWith('$')
    )[0];

    expect(precio.props.children).toBe('$1.800');
  });

  it('indica agotado cuando la oferta no tiene stock', async () => {
    mockListarProductos.mockResolvedValue([
      producto('p-agotado', {
        offers: [oferta({ ofertaId: 'of-agotada', stock: 0, disponible: false })],
      }),
    ]);

    const tree = await renderCatalogo();

    const fila = tree.root.findByProps({ testID: 'catalogo-oferta-of-agotada' });
    expect(textoDe(fila)).toContain('Agotado');
  });

  it('muestra el stock disponible y su precio desde la misma oferta', async () => {
    const tree = await renderCatalogo();

    const fila = tree.root.findByProps({ testID: 'catalogo-oferta-oferta-p-1' });
    expect(textoDe(fila)).toContain('Cafetería Central');
    expect(textoDe(fila)).toContain('$1.800');
    expect(textoDe(fila)).toContain('4 disp.');
  });

  it('indica agotado cuando disponible es false aunque haya stock', async () => {
    mockListarProductos.mockResolvedValue([
      producto('p-sin-disponible', {
        offers: [oferta({ ofertaId: 'of-no-disponible', stock: 9, disponible: false })],
      }),
    ]);

    const tree = await renderCatalogo();

    const fila = tree.root.findByProps({ testID: 'catalogo-oferta-of-no-disponible' });
    expect(textoDe(fila)).toContain('Agotado');
  });

  it('avisa cuando el producto no tiene oferta en la cafetería del campus', async () => {
    mockListarProductos.mockResolvedValue([
      producto('p-sin-oferta', { offers: [oferta({ cafeteriaId: 'cafe-otra-sede' })] }),
    ]);

    const tree = await renderCatalogo();

    expect(tree.root.findByProps({ testID: 'catalogo-sin-oferta-p-sin-oferta' })).toBeTruthy();
    expect(() => tree.root.findByProps({ testID: 'catalogo-oferta-oferta-1' })).toThrow();
  });

  it('muestra el nombre del campus activo', async () => {
    const tree = await renderCatalogo();

    expect(textoDe(tree.root)).toContain('Campus San Juan Pablo II');
  });

  it('filtra por categoría al tocar una pill', async () => {
    const tree = await renderCatalogo();
    mockListarProductos.mockClear();

    await act(async () => {
      tree.root.findByProps({ testID: 'catalogo-chip-cat-pasteleria' }).props.onPress();
    });

    // useFocusEffect vuelve a registrar su callback cuando cambia la categoría,
    // así que el foco se reevalúa: hay que disparar el callback capturado.
    const llamadas = mockUseFocusEffect.mock.calls;
    await act(async () => {
      llamadas[llamadas.length - 1][0]();
    });

    expect(mockListarProductos).toHaveBeenCalledWith('san-juan-pablo-ii', 'cat-pasteleria');
  });

  it('busca sobre los datos reales tolerando typos', async () => {
    const tree = await renderCatalogo();

    // "Amerciano" con una r de más: no coincide por substring, sí por Levenshtein.
    await act(async () => {
      tree.root.findByProps({ testID: 'catalogo-buscar' }).props.onChangeText('Amerciano');
    });

    const texto = textoDe(tree.root);
    expect(texto).toContain('Café Americano 12oz');
    // Croissant no debe aparecer: no matchea la búsqueda.
    expect(texto).not.toContain('Croissant Jamón y Queso');
  });

  it('muestra vacío cuando la búsqueda no encuentra resultados', async () => {
    const tree = await renderCatalogo();

    await act(async () => {
      tree.root.findByProps({ testID: 'catalogo-buscar' }).props.onChangeText('zzzzzzz');
    });

    expect(tree.root.findByProps({ testID: 'catalogo-vacio' })).toBeTruthy();
  });

  it('muestra el error normalizado con botón de reintentar', async () => {
    mockListarCategorias.mockRejectedValue(new ApiError('Catálogo no disponible', 500));

    const tree = await renderCatalogo();

    expect(tree.root.findByProps({ testID: 'catalogo-error' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'catalogo-reintentar' })).toBeTruthy();
  });

  it('reintenta la carga al pulsar el botón', async () => {
    mockListarCategorias.mockRejectedValue(new ApiError('Catálogo no disponible', 500));
    const tree = await renderCatalogo();
    const llamadasAntes = mockListarCategorias.mock.calls.length;

    mockListarCategorias.mockResolvedValue(categoriasMock);
    await act(async () => {
      tree.root.findByProps({ testID: 'catalogo-reintentar' }).props.onPress();
    });

    expect(mockListarCategorias.mock.calls.length).toBe(llamadasAntes + 1);
  });
});
