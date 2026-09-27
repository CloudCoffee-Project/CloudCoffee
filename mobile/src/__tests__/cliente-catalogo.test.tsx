// src/__tests__/cliente-catalogo.test.tsx
// Cubre el catálogo del cliente (INT4-28 categorías y productos, INT4-29
// búsqueda, INT4-31 comparación de precios, INT4-34 agregar/quitar desde la
// tarjeta): carga desde el servicio, precio tomado de la Oferta de la
// cafetería del campus, estado de stock, filtrado por categoría, búsqueda
// tolerante a typos y error normalizado con reintento.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import CatalogoProductosScreen from '../app/(cliente)/index';
import { leerCampusSeleccionado, listarCategorias, listarProductos } from '../services/catalog';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '../services/httpClient';
import { CarritoProvider } from '../context/CarritoContext';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

// Desde INT4-34 la tarjeta escribe en el carrito global, así que el catálogo
// necesita el provider real: los tests de agregar y quitar tienen que ver el
// mismo estado que la pantalla del carrito, no una lista armada a mano.
// AuthContext se mockea porque el provider solo necesita saber quién tiene la
// sesión abierta.
jest.mock('../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    sesion: { userId: 'user-1', rol: 'cliente', cafeteriaId: null, exp: 0 },
    bootstrapping: false,
    iniciarSesion: jest.fn(),
    cerrarSesion: jest.fn(),
  })),
}));

jest.mock('../services/catalog', () => ({
  // requireActual para conservar las funciones puras (ordenarOfertasPorPrecio) y
  // mockear solo el tráfico HTTP de este módulo.
  ...jest.requireActual('../services/catalog'),
  leerCampusSeleccionado: jest.fn(),
  listarCategorias: jest.fn(),
  listarProductos: jest.fn(),
}));

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
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
    tree = create(
      <CarritoProvider>
        <CatalogoProductosScreen />
      </CarritoProvider>
    );
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

  it('lista todas las ofertas del producto, una por cafetería del campus', async () => {
    // El modelo es Campus 1:N Cafeteria: el mismo producto puede tener un
    // precio distinto en cada punto de retiro de la sede.
    mockListarProductos.mockResolvedValue([
      producto('p-2-ofertas', {
        offers: [
          oferta({ ofertaId: 'of-central', cafeteriaNombre: 'Cafetería Central', precio: 1800 }),
          oferta({ ofertaId: 'of-norte', cafeteriaNombre: 'Cafetería Norte', precio: 2100 }),
        ],
      }),
    ]);

    const tree = await renderCatalogo();

    const central = tree.root.findByProps({ testID: 'catalogo-oferta-of-central' });
    const norte = tree.root.findByProps({ testID: 'catalogo-oferta-of-norte' });
    expect(textoDe(central)).toContain('Cafetería Central');
    expect(textoDe(central)).toContain('$1.800');
    expect(textoDe(norte)).toContain('Cafetería Norte');
    expect(textoDe(norte)).toContain('$2.100');
  });

  it('muestra el precio aunque el campus no declare cafeterías', async () => {
    // El precio sale de Producto.offers, que el endpoint ya devuelve acotado al
    // campus: no hace falta que el DTO del campus traiga la cafetería.
    mockLeerCampus.mockResolvedValue({
      id: '9f3c1a2b-0000-4000-8000-000000000001',
      nombre: 'Campus Nordico',
      direccion: 'Ruta 5, Temuco',
    });

    const tree = await renderCatalogo();

    expect(mockListarProductos).toHaveBeenCalledWith(
      '9f3c1a2b-0000-4000-8000-000000000001',
      undefined
    );
    const fila = tree.root.findByProps({ testID: 'catalogo-oferta-oferta-p-1' });
    expect(textoDe(fila)).toContain('$1.800');
  });

  it('abre el detalle del producto al tocar la tarjeta', async () => {
    const tree = await renderCatalogo();

    await act(async () => {
      tree.root.findByProps({ testID: 'catalogo-producto-p-1' }).props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/producto/[id]',
      params: { id: 'p-1' },
    });
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

  it('avisa cuando el producto no tiene ninguna oferta en el campus', async () => {
    mockListarProductos.mockResolvedValue([producto('p-sin-oferta', { offers: [] })]);

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

// Orden de las cafeterías por precio dentro de cada tarjeta (INT4-31). Mismo
// criterio que el detalle: el servicio no garantiza el orden de las ofertas, así
// que los datos entran desordenados a propósito.
describe('comparación de precios entre cafeterías (INT4-31)', () => {
  const PREFIJO = 'catalogo-oferta-';

  // Solo las ofertas del producto p-1, para no mezclar las de las otras tarjetas.
  function idsOfertasDeP1(tree: ReactTestRenderer): string[] {
    const ids = tree.root
      .findAll(
        (nodo) => typeof nodo.props?.testID === 'string' && nodo.props.testID.startsWith(PREFIJO)
      )
      .map((nodo) => (nodo.props.testID as string).slice(PREFIJO.length))
      .filter((id) => id.startsWith('of-p1-'));

    return ids.filter((id, i) => ids.indexOf(id) === i);
  }

  function catalogoConTresCafeterias(): Producto[] {
    return [
      producto('p-1', {
        nombre: 'Café Americano 12oz',
        offers: [
          oferta({
            ofertaId: 'of-p1-sur',
            cafeteriaNombre: 'Cafetería Sur',
            precio: 2100,
            stock: 2,
          }),
          oferta({
            ofertaId: 'of-p1-central',
            cafeteriaNombre: 'Cafetería Central',
            precio: 1500,
            stock: 4,
          }),
          oferta({
            ofertaId: 'of-p1-norte',
            cafeteriaNombre: 'Cafetería Norte',
            precio: 1800,
            stock: 3,
          }),
        ],
      }),
      producto('p-2', { nombre: 'Croissant Jamón y Queso' }),
    ];
  }

  beforeEach(() => {
    mockListarProductos.mockResolvedValue(catalogoConTresCafeterias());
  });

  it('ordena las cafeterías de la tarjeta de menor a mayor', async () => {
    const tree = await renderCatalogo();

    expect(idsOfertasDeP1(tree)).toEqual(['of-p1-central', 'of-p1-norte', 'of-p1-sur']);
  });

  it('deja las agotadas en la escalera de precios, no al final', async () => {
    mockListarProductos.mockResolvedValue([
      producto('p-1', {
        offers: [
          oferta({
            ofertaId: 'of-p1-agotada',
            cafeteriaNombre: 'Cafetería Agotada',
            precio: 1200,
            stock: 0,
            disponible: false,
          }),
          oferta({
            ofertaId: 'of-p1-norte',
            cafeteriaNombre: 'Cafetería Norte',
            precio: 1800,
            stock: 3,
          }),
        ],
      }),
    ]);

    const tree = await renderCatalogo();

    expect(idsOfertasDeP1(tree)).toEqual(['of-p1-agotada', 'of-p1-norte']);
  });

  it('mantiene el orden al cambiar la búsqueda', async () => {
    const tree = await renderCatalogo();

    await act(async () => {
      tree.root.findByProps({ testID: 'catalogo-buscar' }).props.onChangeText('Café');
    });

    expect(idsOfertasDeP1(tree)).toEqual(['of-p1-central', 'of-p1-norte', 'of-p1-sur']);
  });

  it('no ofrece control de orden: la lista no se puede invertir', async () => {
    const tree = await renderCatalogo();

    expect(tree.root.findAll((nodo) => nodo.props?.testID === 'catalogo-orden')).toHaveLength(0);
  });
});
