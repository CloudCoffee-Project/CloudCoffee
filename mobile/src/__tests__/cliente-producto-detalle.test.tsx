// src/__tests__/cliente-producto-detalle.test.tsx
// Cubre el detalle de producto (INT4-30): carga desde el servicio con el campus
// activo, lista de ofertas (una por cafetería, con su precio y stock),
// selección de punto de retiro, cantidad acotada al stock, total real, y los
// estados de error/vacío/sin campus con sus salidas.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import DetalleProductoScreen from '../app/(cliente)/producto/[id]';
import { leerCampusSeleccionado, listarCategorias, obtenerProducto } from '../services/catalog';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ApiError } from '../services/httpClient';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

jest.mock('../services/catalog', () => ({
  leerCampusSeleccionado: jest.fn(),
  listarCategorias: jest.fn(),
  obtenerProducto: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockRouter = { push: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: jest.fn(() => mockRouter),
  useLocalSearchParams: jest.fn(() => ({ id: 'prod-1' })),
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
const mockObtenerProducto = obtenerProducto as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;
const mockParams = useLocalSearchParams as unknown as jest.Mock;

const campusMock: Campus = {
  id: 'campus-1',
  nombre: 'Campus San Francisco',
  direccion: 'Manuel Montt 056, Temuco',
};

const categoriasMock: Categoria[] = [
  { id: 'cat-bebidas', nombre: 'Bebidas' },
  { id: 'cat-pasteleria', nombre: 'Pastelería' },
];

function oferta(over: Partial<Oferta> = {}): Oferta {
  return {
    ofertaId: 'of-central',
    cafeteriaId: 'cafe-central',
    cafeteriaNombre: 'Cafetería Central',
    precio: 1800,
    stock: 4,
    disponible: true,
    ...over,
  };
}

function producto(over: Partial<Producto> = {}): Producto {
  return {
    id: 'prod-1',
    nombre: 'Café Americano 12oz',
    descripcion: 'Espresso doble con agua caliente.',
    categoriaId: 'cat-bebidas',
    offers: [oferta()],
    ...over,
  };
}

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

let arbolActual: ReactTestRenderer | null = null;

async function renderDetalle(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<DetalleProductoScreen />);
  });
  arbolActual = tree;

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });

  return tree;
}

beforeEach(() => {
  mockLeerCampus.mockReset();
  mockListarCategorias.mockReset();
  mockObtenerProducto.mockReset();
  mockUseFocusEffect.mockReset();
  mockParams.mockReset();
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
  mockParams.mockReturnValue({ id: 'prod-1' });
  mockLeerCampus.mockResolvedValue(campusMock);
  mockListarCategorias.mockResolvedValue(categoriasMock);
  mockObtenerProducto.mockResolvedValue(producto());
});

afterEach(() => {
  if (arbolActual !== null) {
    act(() => arbolActual?.unmount());
    arbolActual = null;
  }
});

describe('Detalle de producto', () => {
  it('pide el producto con el campus activo', async () => {
    const tree = await renderDetalle();

    expect(mockObtenerProducto).toHaveBeenCalledWith('prod-1', 'campus-1');
    expect(mockListarCategorias).toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'producto-detalle-scroll' })).toBeTruthy();
  });

  it('muestra nombre, descripción y categoría real del producto', async () => {
    const tree = await renderDetalle();

    const texto = textoDe(tree.root);
    expect(texto).toContain('Café Americano 12oz');
    expect(texto).toContain('Espresso doble con agua caliente.');
    expect(texto).toContain('Bebidas');
  });

  it('omite la pastilla de categoría si no se puede resolver el nombre', async () => {
    mockObtenerProducto.mockResolvedValue(producto({ categoriaId: 'cat-desconocida' }));

    const tree = await renderDetalle();

    expect(textoDe(tree.root)).not.toContain('Bebidas');
    expect(textoDe(tree.root)).toContain('Café Americano 12oz');
  });

  it('lista todas las ofertas con precio, ubicación y stock', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({ ofertaId: 'of-central', cafeteriaNombre: 'Cafetería Central', precio: 1800 }),
          oferta({
            ofertaId: 'of-norte',
            cafeteriaId: 'cafe-norte',
            cafeteriaNombre: 'Cafetería Norte',
            precio: 2100,
            stock: 2,
          }),
        ],
      })
    );

    const tree = await renderDetalle();

    const central = tree.root.findByProps({ testID: 'producto-detalle-oferta-of-central' });
    const norte = tree.root.findByProps({ testID: 'producto-detalle-oferta-of-norte' });
    expect(textoDe(central)).toContain('Cafetería Central');
    expect(textoDe(central)).toContain('$1.800');
    // La ubicación es la del campus: Cafetería no tiene dirección propia.
    expect(textoDe(central)).toContain('Manuel Montt 056');
    expect(textoDe(norte)).toContain('Cafetería Norte');
    expect(textoDe(norte)).toContain('$2.100');
  });

  it('preselecciona la primera oferta disponible', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({ ofertaId: 'of-agotada', stock: 0, disponible: false }),
          oferta({ ofertaId: 'of-norte', cafeteriaNombre: 'Cafetería Norte', precio: 2100 }),
        ],
      })
    );

    const tree = await renderDetalle();

    // Agotada no se elige sola: el pie muestra el precio de la que sí hay.
    const boton = tree.root.findByProps({ testID: 'producto-detalle-agregar' });
    expect(textoDe(boton)).toContain('$2.100');
  });

  it('cambia a otra cafetería al tocar su tarjeta', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({ ofertaId: 'of-central', precio: 1800 }),
          oferta({ ofertaId: 'of-norte', cafeteriaNombre: 'Cafetería Norte', precio: 2100 }),
        ],
      })
    );

    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-oferta-of-norte' }).props.onPress();
    });

    const boton = tree.root.findByProps({ testID: 'producto-detalle-agregar' });
    expect(textoDe(boton)).toContain('$2.100');
  });

  it('no deja elegir una oferta agotada', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({ ofertaId: 'of-central', precio: 1800 }),
          oferta({
            ofertaId: 'of-agotada',
            cafeteriaNombre: 'Cafetería Norte',
            stock: 0,
            disponible: false,
          }),
        ],
      })
    );

    const tree = await renderDetalle();

    const agotada = tree.root.findByProps({ testID: 'producto-detalle-oferta-of-agotada' });
    expect(agotada.props.disabled).toBe(true);
    expect(textoDe(agotada)).toContain('Agotado');

    // El intento de seleccionarla no cambia el pie, que sigue en la otra.
    await act(async () => {
      agotada.props.onPress();
    });
    const boton = tree.root.findByProps({ testID: 'producto-detalle-agregar' });
    expect(textoDe(boton)).toContain('$1.800');
  });

  it('muestra el total real al cambiar la cantidad', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({ offers: [oferta({ precio: 1800, stock: 4 })] })
    );

    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-mas' }).props.onPress();
    });

    // 1.800 x 2
    const boton = tree.root.findByProps({ testID: 'producto-detalle-agregar' });
    expect(textoDe(boton)).toContain('$3.600');
  });

  it('no deja superar el stock disponible', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({ offers: [oferta({ precio: 1800, stock: 2 })] })
    );

    const tree = await renderDetalle();

    const mas = () => tree.root.findByProps({ testID: 'producto-detalle-mas' });
    const boton = () => tree.root.findByProps({ testID: 'producto-detalle-agregar' });

    // Hay stock para una unidad más, así que el botón sigue activo.
    expect(mas().props.disabled).toBe(false);

    await act(async () => {
      mas().props.onPress();
    });
    // 2 unidades = todo el stock: no se puede pedir una tercera.
    expect(mas().props.disabled).toBe(true);
    expect(textoDe(boton())).toContain('$3.600');

    // Aunque se dispare el handler igual, el tope se mantiene.
    await act(async () => {
      mas().props.onPress();
    });
    expect(textoDe(boton())).toContain('$3.600');
  });

  it('no deja bajar de una unidad', async () => {
    const tree = await renderDetalle();

    const menos = tree.root.findByProps({ testID: 'producto-detalle-menos' });
    expect(menos.props.disabled).toBe(true);
  });

  it('muestra el pie deshabilitado cuando todo está agotado', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({ offers: [oferta({ stock: 0, disponible: false })] })
    );

    const tree = await renderDetalle();

    const boton = tree.root.findByProps({ testID: 'producto-detalle-agregar' });
    expect(boton.props.disabled).toBe(true);
    expect(textoDe(boton)).toContain('Agotado en este punto');
    expect(() => tree.root.findByProps({ testID: 'producto-detalle-cantidad' })).toThrow();
  });

  it('lleva al carrito al agregar, con el TODO del armado pendiente', async () => {
    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-agregar' }).props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith('/(cliente)/carrito');
  });

  it('vuelve al catálogo con el botón volver', async () => {
    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-volver' }).props.onPress();
    });

    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('pide elegir sede cuando no hay campus activo', async () => {
    mockLeerCampus.mockResolvedValue(null);

    const tree = await renderDetalle();

    expect(mockObtenerProducto).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'producto-detalle-sin-campus' })).toBeTruthy();
  });

  it('lleva a la selección de sede desde el aviso sin campus', async () => {
    mockLeerCampus.mockResolvedValue(null);

    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-ir-campus' }).props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith('/(cliente)/campus');
  });

  it('avisa cuando el producto no tiene ofertas en el campus', async () => {
    mockObtenerProducto.mockResolvedValue(producto({ offers: [] }));

    const tree = await renderDetalle();

    expect(tree.root.findByProps({ testID: 'producto-detalle-sin-ofertas' })).toBeTruthy();
    // Sin ofertas no hay pie que pueda mentir sobre un precio.
    expect(() => tree.root.findByProps({ testID: 'producto-detalle-agregar' })).toThrow();
  });

  it('muestra el error normalizado con botón de reintentar', async () => {
    mockObtenerProducto.mockRejectedValue(new ApiError('Producto no encontrado', 404));

    const tree = await renderDetalle();

    expect(tree.root.findByProps({ testID: 'producto-detalle-error' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'producto-detalle-reintentar' })).toBeTruthy();
  });

  it('reintenta la carga al pulsar el botón', async () => {
    mockObtenerProducto.mockRejectedValue(new ApiError('Producto no encontrado', 404));
    const tree = await renderDetalle();
    const llamadasAntes = mockObtenerProducto.mock.calls.length;

    mockObtenerProducto.mockResolvedValue(producto());
    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-reintentar' }).props.onPress();
    });

    expect(mockObtenerProducto.mock.calls.length).toBe(llamadasAntes + 1);
    expect(tree.root.findByProps({ testID: 'producto-detalle-scroll' })).toBeTruthy();
  });

  it('avisa cuando el producto no tiene ofertas y su categoría no resuelve', async () => {
    mockObtenerProducto.mockResolvedValue(producto({ offers: [], categoriaId: 'cat-desconocida' }));

    const tree = await renderDetalle();

    expect(tree.root.findByProps({ testID: 'producto-detalle-sin-ofertas' })).toBeTruthy();
  });

  it('avisa cuando falta el id del producto en la ruta', async () => {
    mockParams.mockReturnValue({});

    const tree = await renderDetalle();

    expect(mockObtenerProducto).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'producto-detalle-error' })).toBeTruthy();
  });
});
