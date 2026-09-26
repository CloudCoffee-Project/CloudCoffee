// src/__tests__/cliente-producto-detalle.test.tsx
// Cubre el detalle de producto (INT4-30): carga desde el servicio con el campus
// activo, lista de ofertas (una por cafetería, con su precio y stock),
// selección de punto de retiro, cantidad acotada al stock, total real, y los
// estados de error/vacío/sin campus con sus salidas.
// Y el paso a INT4-32: el botón de agregar suma la oferta elegida al carrito
// global y confirma con un aviso que se va solo. No navega.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import DetalleProductoScreen from '../app/(cliente)/producto/[id]';
import { leerCampusSeleccionado, listarCategorias, obtenerProducto } from '../services/catalog';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ApiError } from '../services/httpClient';
import { CarritoProvider, useCarrito } from '../context/CarritoContext';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

// INT4-32: la pantalla ya no navega al carrito al agregar, lo escribe en el
// carrito global. Se monta el provider real (no un mock de useCarrito) para que
// el test cubra de verdad que el botón alimenta el estado que después va a
// leer la pantalla del carrito. AuthContext se mockea porque el provider solo
// necesita saber quién tiene la sesión abierta.
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

// Lee el carrito global desde adentro del provider, que es como lo va a leer la
// pantalla del carrito en INT4-33+. El valor queda en las props de un nodo del
// árbol y no en una variable de módulo: asignarla durante el render es un efecto
// y el compilador de React lo rechaza.
function SondaCarrito() {
  const valor = useCarrito();
  return <View testID="carrito-sonda" {...valor} />;
}

function leerCarrito(tree: ReactTestRenderer): ReturnType<typeof useCarrito> {
  return tree.root.findAllByProps({ testID: 'carrito-sonda' })[0].props as ReturnType<
    typeof useCarrito
  >;
}

async function renderDetalle(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CarritoProvider>
        <SondaCarrito />
        <DetalleProductoScreen />
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

  it('agrega al carrito global la cafetería elegida, sin navegar al carrito', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({ ofertaId: 'of-central', cafeteriaNombre: 'Cafetería Central', precio: 1800 }),
          oferta({ ofertaId: 'of-norte', cafeteriaNombre: 'Cafetería Norte', precio: 2100 }),
        ],
      })
    );

    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-oferta-of-norte' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-agregar' }).props.onPress();
    });

    // Lo que entra al carrito es la oferta que el usuario tocó, no la más
    // barata: el precio de la línea sale de la cafetería elegida.
    expect(leerCarrito(tree).items).toEqual([
      {
        ofertaId: 'of-norte',
        productoId: 'prod-1',
        productoNombre: 'Café Americano 12oz',
        precioUnitario: 2100,
        cafeteriaId: 'cafe-central',
        cafeteriaNombre: 'Cafetería Norte',
        cantidad: 1,
        stock: 4,
      },
    ]);
    expect(leerCarrito(tree).total).toBe(2100);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('agrega la cantidad que se está mirando, no siempre una', async () => {
    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-mas' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-agregar' }).props.onPress();
    });

    expect(leerCarrito(tree).items[0].cantidad).toBe(2);
    expect(leerCarrito(tree).unidades).toBe(2);
    expect(leerCarrito(tree).total).toBe(3600);
  });

  it('suma en la misma línea si se agrega dos veces la misma cafetería', async () => {
    const tree = await renderDetalle();

    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-agregar' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-agregar' }).props.onPress();
    });

    expect(leerCarrito(tree).items).toHaveLength(1);
    expect(leerCarrito(tree).items[0].cantidad).toBe(2);
  });

  it('no agrega nada si el botón está deshabilitado por estar agotado', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({ offers: [oferta({ stock: 0, disponible: false })] })
    );

    const tree = await renderDetalle();
    const boton = tree.root.findByProps({ testID: 'producto-detalle-agregar' });

    await act(async () => {
      boton.props.onPress();
    });

    expect(leerCarrito(tree).items).toEqual([]);
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

// Aviso de "agregado al carrito". El mockup no lo tiene: se agregó porque el
// botón dejó de navegar al carrito, así que sin una confirmación el usuario no
// tiene forma de saber que el producto entró. Solo debe confirmar, nunca
// cambiar lo que se agregó ni tapping de más.
describe('aviso de producto agregado (INT4-32)', () => {
  const AVISO = 'producto-detalle-aviso';

  const boton = (tree: ReactTestRenderer): ReactTestInstance =>
    tree.root.findByProps({ testID: 'producto-detalle-agregar' });
  const mas = (tree: ReactTestRenderer): ReactTestInstance =>
    tree.root.findByProps({ testID: 'producto-detalle-mas' });

  async function agregar(tree: ReactTestRenderer): Promise<void> {
    await act(async () => {
      boton(tree).props.onPress();
    });
  }

  function avisosEnPantalla(tree: ReactTestRenderer): ReactTestInstance[] {
    // Animated.View emite el testID en el componente y en la View que
    // renderiza, así que findAllByProps contaría de más. Se filtra por nodo
    // host (type string) para contar el aviso una sola vez.
    return tree.root.findAll(
      (nodo) => typeof nodo.type === 'string' && nodo.props?.testID === AVISO
    );
  }

  it('no muestra aviso antes de agregar nada', async () => {
    const tree = await renderDetalle();

    expect(avisosEnPantalla(tree)).toHaveLength(0);
  });

  it('confirma con el producto y la cantidad que entraron', async () => {
    const tree = await renderDetalle();

    await agregar(tree);

    const texto = textoDe(avisosEnPantalla(tree)[0]);
    expect(texto).toContain('Agregado al carrito');
    expect(texto).toContain('Café Americano 12oz');
    expect(texto).toContain('1 ×');
  });

  it('dice la cantidad que se estaba mirando, no siempre una', async () => {
    const tree = await renderDetalle();

    await act(async () => {
      mas(tree).props.onPress();
    });
    await agregar(tree);

    expect(textoDe(avisosEnPantalla(tree)[0])).toContain('2 ×');
  });

  it('confirma la cafetería que se eligió, no la más barata', async () => {
    // El aviso es informativo: la línea que entró al carrito la decide el
    // usuario, y el texto tiene que acompañar esa decisión.
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({ ofertaId: 'of-central', cafeteriaNombre: 'Cafetería Central', precio: 1500 }),
          oferta({ ofertaId: 'of-norte', cafeteriaNombre: 'Cafetería Norte', precio: 2100 }),
        ],
      })
    );

    const tree = await renderDetalle();
    await act(async () => {
      tree.root.findByProps({ testID: 'producto-detalle-oferta-of-norte' }).props.onPress();
    });
    await agregar(tree);

    expect(leerCarrito(tree).items[0].precioUnitario).toBe(2100);
    expect(textoDe(avisosEnPantalla(tree)[0])).toContain('1 × Café Americano 12oz');
  });

  it('se va solo a los dos segundos, sin que el usuario toque nada', async () => {
    const tree = await renderDetalle();

    // Se monta con reloj real y se fakea recién antes de agregar: el montaje
    // inicial resuelve promesas, y con el reloj fake el act se enreda.
    jest.useFakeTimers();
    try {
      await agregar(tree);
      expect(avisosEnPantalla(tree)).toHaveLength(1);

      // La secuencia de la pantalla es entrada (160) + 2s + salida (200).
      await act(async () => {
        jest.advanceTimersByTime(2500);
      });

      expect(avisosEnPantalla(tree)).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('reinicia el aviso al agregar otra vez en vez de dejarlo a medias', async () => {
    const tree = await renderDetalle();

    jest.useFakeTimers();
    try {
      await agregar(tree);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      // A mitad de los 2 segundos, todavía en pantalla.
      expect(avisosEnPantalla(tree)).toHaveLength(1);

      // Agregar de nuevo reinicia la cuenta: el aviso anterior se frena.
      await agregar(tree);
      expect(avisosEnPantalla(tree)).toHaveLength(1);
      expect(leerCarrito(tree).items[0].cantidad).toBe(2);

      await act(async () => {
        jest.advanceTimersByTime(2500);
      });
      expect(avisosEnPantalla(tree)).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('no avisa nada si el botón está deshabilitado por estar agotado', async () => {
    mockObtenerProducto.mockResolvedValue(
      producto({ offers: [oferta({ stock: 0, disponible: false })] })
    );

    const tree = await renderDetalle();
    await agregar(tree);

    expect(avisosEnPantalla(tree)).toHaveLength(0);
    expect(leerCarrito(tree).items).toEqual([]);
  });

  it('frena la animación al cerrar la pantalla con el aviso en pantalla', async () => {
    const tree = await renderDetalle();
    await agregar(tree);

    jest.useFakeTimers();
    try {
      await act(async () => {
        tree.unmount();
      });
      arbolActual = null;

      // La animación quedó frenada al desmontar: el reloj no dispara nada.
      expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });
});

// Orden de las cafeterías por precio (INT4-31). El servicio entrega las ofertas
// en el orden que le sale de la consulta, así que los datos de estas pruebas van
// deliberadamente desordenados: si la pantalla no ordenara, el orden de salida
// sería siempre el de entrada.
describe('comparación de precios entre cafeterías (INT4-31)', () => {
  const PREFIJO = 'producto-detalle-oferta-';

  // findAll devuelve los nodos en orden de render, que es el orden en pantalla.
  // El mismo testID puede aparecer en el Pressable y en la View que renderiza,
  // así que se deduplica conservando la primera aparición.
  function idsOfertasEnPantalla(tree: ReactTestRenderer): string[] {
    const ids = tree.root
      .findAll(
        (nodo) => typeof nodo.props?.testID === 'string' && nodo.props.testID.startsWith(PREFIJO)
      )
      .map((nodo) => (nodo.props.testID as string).slice(PREFIJO.length));

    return ids.filter((id, i) => ids.indexOf(id) === i);
  }

  const tresOfertas = [
    oferta({ ofertaId: 'of-sur', cafeteriaNombre: 'Cafetería Sur', precio: 2100, stock: 2 }),
    oferta({
      ofertaId: 'of-central',
      cafeteriaNombre: 'Cafetería Central',
      precio: 1500,
      stock: 4,
    }),
    oferta({ ofertaId: 'of-norte', cafeteriaNombre: 'Cafetería Norte', precio: 1800, stock: 3 }),
  ];

  it('muestra las cafeterías de menor a mayor aunque el servicio entregue otro orden', async () => {
    mockObtenerProducto.mockResolvedValue(producto({ offers: tresOfertas }));

    const tree = await renderDetalle();

    expect(idsOfertasEnPantalla(tree)).toEqual(['of-central', 'of-norte', 'of-sur']);
  });

  it('deja las agotadas en la escalera de precios, no al final', async () => {
    // Agotada es la más barata: tiene que quedar primera, en su precio.
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({
            ofertaId: 'of-agotada',
            cafeteriaNombre: 'Cafetería Agotada',
            precio: 1200,
            stock: 0,
            disponible: false,
          }),
          oferta({
            ofertaId: 'of-norte',
            cafeteriaNombre: 'Cafetería Norte',
            precio: 1800,
            stock: 3,
          }),
          oferta({ ofertaId: 'of-sur', cafeteriaNombre: 'Cafetería Sur', precio: 2100, stock: 2 }),
        ],
      })
    );

    const tree = await renderDetalle();

    expect(idsOfertasEnPantalla(tree)).toEqual(['of-agotada', 'of-norte', 'of-sur']);
  });

  it('preselecciona la más barata disponible', async () => {
    mockObtenerProducto.mockResolvedValue(producto({ offers: tresOfertas }));

    const tree = await renderDetalle();

    // Central a $1.500, que es la primera de la lista y la más barata.
    expect(textoDe(tree.root.findByProps({ testID: 'producto-detalle-agregar' }))).toContain(
      '$1.500'
    );
  });

  it('preselecciona la más barata disponible aunque haya una agotada más barata', async () => {
    // La agotada de $1.200 va primera en la lista, pero no se puede comprar: la
    // que debe quedar seleccionada es la más barata con stock.
    mockObtenerProducto.mockResolvedValue(
      producto({
        offers: [
          oferta({
            ofertaId: 'of-agotada',
            cafeteriaNombre: 'Cafetería Agotada',
            precio: 1200,
            stock: 0,
            disponible: false,
          }),
          oferta({
            ofertaId: 'of-norte',
            cafeteriaNombre: 'Cafetería Norte',
            precio: 1800,
            stock: 3,
          }),
        ],
      })
    );

    const tree = await renderDetalle();

    expect(textoDe(tree.root.findByProps({ testID: 'producto-detalle-agregar' }))).toContain(
      '$1.800'
    );
  });

  it('mantiene el orden al recargar el producto', async () => {
    mockObtenerProducto.mockResolvedValue(producto({ offers: tresOfertas }));
    const tree = await renderDetalle();

    // Reintento de carga: el producto vuelve a pedirse desde el servicio.
    const llamadas = mockUseFocusEffect.mock.calls;
    await act(async () => {
      llamadas[llamadas.length - 1][0]();
    });

    expect(idsOfertasEnPantalla(tree)).toEqual(['of-central', 'of-norte', 'of-sur']);
  });

  it('no ofrece control de orden: la lista no se puede invertir', async () => {
    mockObtenerProducto.mockResolvedValue(producto({ offers: tresOfertas }));

    const tree = await renderDetalle();

    expect(
      tree.root.findAll((nodo) => nodo.props?.testID === 'producto-detalle-orden')
    ).toHaveLength(0);
  });
});
