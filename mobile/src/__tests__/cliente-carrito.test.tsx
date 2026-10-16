// src/__tests__/cliente-carrito.test.tsx
// Cubre la pantalla del carrito (INT4-33): el estado de INT4-32 agrupado por
// cafetería, los subtotales por punto de retiro, el total general, los controles
// de cada línea (stepper, borrar) y el estado vacío. El flujo de pago es el de
// INT4-38/39 y acá solo se comprueba que el botón que lo dispara muestra el total
// real y lo llama.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import CarritoScreen from '../app/(cliente)/carrito';
import { CarritoProvider, useCarrito } from '../context/CarritoContext';
import type { ItemCarrito, NuevoItemCarrito } from '../types/domain';

// La pantalla no pide nada al backend: todo lo que muestra sale del carrito en
// memoria. El provider se monta real, no mockeado, para que la prueba cubra de
// verdad el agrupado, los subtotales y los totales que ve el usuario. AuthContext
// se mockea porque el provider solo necesita saber quién tiene la sesión abierta.
jest.mock('../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    sesion: { userId: 'user-1', rol: 'cliente', cafeteriaId: null, exp: 0 },
    bootstrapping: false,
    iniciarSesion: jest.fn(),
    cerrarSesion: jest.fn(),
  })),
}));

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };

jest.mock('expo-router', () => ({
  // Getter y no un valor fijo: la fábrica del mock corre cuando se importa la
  // pantalla, antes de que exista la constante mockRouter. Con un getter, router
  // se resuelve recién cuando el botón lo usa, que es cuando ya está listo.
  get router() {
    return mockRouter;
  },
  useRouter: jest.fn(() => mockRouter),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: (props: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(View, props, props.children),
  };
});

function linea(over: Partial<NuevoItemCarrito> = {}): NuevoItemCarrito {
  return {
    ofertaId: 'of-central-cafe',
    productoId: 'prod-cafe',
    productoNombre: 'Café Americano 12oz',
    precioUnitario: 1800,
    cafeteriaId: 'cafe-central',
    cafeteriaNombre: 'Cafetería Central',
    stock: 5,
    ...over,
  };
}

const norte = (over: Partial<NuevoItemCarrito> = {}): NuevoItemCarrito =>
  linea({
    ofertaId: 'of-norte-cafe',
    cafeteriaId: 'cafe-norte',
    cafeteriaNombre: 'Cafetería Norte',
    precioUnitario: 2100,
    stock: 3,
    ...over,
  });

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

let arbolActual: ReactTestRenderer | null = null;

// Lee el carrito global desde adentro del provider. El valor queda en las props
// de un nodo del árbol y no en una variable de módulo: asignarla durante el
// render es un efecto y el compilador de React lo rechaza.
function SondaCarrito() {
  const valor = useCarrito();
  return <View testID="carrito-sonda" {...valor} />;
}

function leerCarrito(tree: ReactTestRenderer): ReturnType<typeof useCarrito> {
  return tree.root.findAllByProps({ testID: 'carrito-sonda' })[0].props as ReturnType<
    typeof useCarrito
  >;
}

async function renderCarrito(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <CarritoProvider>
        <SondaCarrito />
        <CarritoScreen />
      </CarritoProvider>
    );
  });
  arbolActual = tree;
  return tree;
}

// Agrega al carrito global por la misma vía que usa el detalle de producto, para
// que la pantalla reciba el estado real y no una lista armada a mano.
async function agregar(
  tree: ReactTestRenderer,
  item: NuevoItemCarrito = linea(),
  cantidad = 1
): Promise<void> {
  await act(async () => {
    leerCarrito(tree).agregar(item, cantidad);
  });
}

async function pulsar(tree: ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    tree.root.findByProps({ testID }).props.onPress();
  });
}

// Las cafeterías en el orden en que se pintan. findAll devuelve los nodos en
// orden de render, que es el orden en pantalla, así que no hay que reordenar
// nada. El prefijo de los grupos también lo usan el badge y el subtotal de cada
// uno, así que hay que dejarlos fuera, y el mismo testID aparece en el nodo y en
// la View que renderiza, así que se deduplica conservando la primera aparición.
const PREFIJO_GRUPO = 'carrito-grupo-';

function idsGruposEnPantalla(tree: ReactTestRenderer): string[] {
  const ids = tree.root
    .findAll((nodo) => {
      const id = nodo.props?.testID;
      return (
        typeof id === 'string' &&
        id.startsWith(PREFIJO_GRUPO) &&
        !id.startsWith(`${PREFIJO_GRUPO}badge-`) &&
        !id.startsWith(`${PREFIJO_GRUPO}subtotal-`)
      );
    })
    .map((nodo) => (nodo.props.testID as string).slice(PREFIJO_GRUPO.length));

  return ids.filter((id, i) => ids.indexOf(id) === i);
}

function texto(tree: ReactTestRenderer, testID: string): string {
  return textoDe(tree.root.findByProps({ testID }));
}

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
  mockRouter.replace.mockClear();
  // El flujo de pago loguea a propósito; sin esto la salida de la suite se
  // llena de warnings que no dicen nada del comportamiento que se está probando.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (arbolActual !== null) {
    act(() => arbolActual?.unmount());
    arbolActual = null;
  }
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('Carrito agrupado por cafetería (INT4-33)', () => {
  it('invita a explorar el catálogo cuando no hay nada comprado', async () => {
    const tree = await renderCarrito();

    expect(tree.root.findByProps({ testID: 'carrito-vacio' })).toBeTruthy();
    expect(textoDe(tree.root)).toContain('Tu carrito está vacío');
    expect(texto(tree, 'carrito-origen')).toBe('Carrito sin productos');
  });

  it('sin productos no hay ni método de pago ni botón de pagar', async () => {
    const tree = await renderCarrito();

    expect(() => tree.root.findByProps({ testID: 'carrito-metodo-pago' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'carrito-pagar' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'carrito-resumen' })).toThrow();
  });

  it('lleva al catálogo desde el carrito vacío', async () => {
    const tree = await renderCarrito();

    await pulsar(tree, 'carrito-ir-catalogo');

    expect(mockRouter.push).toHaveBeenCalledWith('/(cliente)');
  });

  it('vuelve con el botón del encabezado', async () => {
    const tree = await renderCarrito();

    await pulsar(tree, 'carrito-volver');

    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('arma un grupo por cafetería, con el nombre y sus líneas', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea(), 2);

    expect(tree.root.findByProps({ testID: 'carrito-grupo-cafe-central' })).toBeTruthy();
    expect(textoDe(tree.root)).toContain('Cafetería Central');
    expect(texto(tree, 'carrito-item-of-central-cafe')).toContain('Café Americano 12oz');
    // El precio unitario y el de la línea van por separado, como en el mockup.
    expect(texto(tree, 'carrito-item-of-central-cafe')).toContain('$1.800 c/u');
    expect(texto(tree, 'carrito-item-subtotal-of-central-cafe')).toBe('$3.600');
  });

  it('el badge del grupo cuenta unidades, no líneas', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea(), 3);

    expect(texto(tree, 'carrito-grupo-badge-cafe-central')).toBe('3 productos');
  });

  it('el mismo producto en otra cafetería abre otra línea y otro grupo', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());
    await agregar(tree, norte());

    // Mismo productoId, distinto punto de retiro: son dos compras separadas.
    expect(leerCarrito(tree).items).toHaveLength(2);
    expect(idsGruposEnPantalla(tree)).toEqual(['cafe-central', 'cafe-norte']);
    expect(textoDe(tree.root)).toContain('Cafetería Norte');
  });

  it('mantiene el orden en que el usuario fue agregando cafeterías', async () => {
    const tree = await renderCarrito();
    await agregar(tree, norte());
    await agregar(tree, linea());

    expect(idsGruposEnPantalla(tree)).toEqual(['cafe-norte', 'cafe-central']);
  });

  it('calcula el subtotal de cada cafetería por separado', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea(), 2); // 2 x 1.800
    await agregar(tree, norte()); // 1 x 2.100

    expect(texto(tree, 'carrito-grupo-subtotal-cafe-central')).toBe('$3.600');
    expect(texto(tree, 'carrito-grupo-subtotal-cafe-norte')).toBe('$2.100');
  });

  it('el total general es la suma de los subtotales', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea(), 2);
    await agregar(tree, norte());

    // 3.600 + 2.100
    expect(texto(tree, 'carrito-resumen-total')).toBe('$5.700');
    expect(texto(tree, 'carrito-resumen-subtotal-cafe-central')).toBe(
      'Subtotal (Cafetería Central)$3.600'
    );
    expect(texto(tree, 'carrito-resumen-subtotal-cafe-norte')).toBe(
      'Subtotal (Cafetería Norte)$2.100'
    );
  });

  it('el total que muestra la pantalla es el que calcula el carrito', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea(), 2);
    await agregar(tree, norte());

    expect(leerCarrito(tree).total).toBe(5700);
    expect(leerCarrito(tree).unidades).toBe(3);
  });

  it('avisa el punto de retiro cuando el pedido es en una sola cafetería', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());

    expect(texto(tree, 'carrito-origen')).toBe('📍 Retiro en: Cafetería Central');
  });

  it('avisa cuántos puntos de entrega hay cuando son varias cafeterías', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());
    await agregar(tree, norte());

    expect(texto(tree, 'carrito-origen')).toBe('📦 Retiro programado en 2 puntos de entrega');
  });

  it('suma unidades con el stepper y recalcula subtotal y total', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());

    await pulsar(tree, 'carrito-item-mas-of-central-cafe');

    expect(leerCarrito(tree).items[0].cantidad).toBe(2);
    expect(texto(tree, 'carrito-item-subtotal-of-central-cafe')).toBe('$3.600');
    expect(texto(tree, 'carrito-grupo-subtotal-cafe-central')).toBe('$3.600');
    expect(texto(tree, 'carrito-resumen-total')).toBe('$3.600');
    expect(texto(tree, 'carrito-grupo-badge-cafe-central')).toBe('2 productos');
  });

  it('resta con el stepper sin pasarse de lo comprado', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea(), 2);

    await pulsar(tree, 'carrito-item-menos-of-central-cafe');

    expect(leerCarrito(tree).items[0].cantidad).toBe(1);
    expect(texto(tree, 'carrito-resumen-total')).toBe('$1.800');
  });

  it('no deja pedir más que el stock que tenía la oferta', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea({ stock: 1 }));

    const mas = tree.root.findByProps({ testID: 'carrito-item-mas-of-central-cafe' });
    expect(mas.props.disabled).toBe(true);

    // El handler tampoco sube la cantidad aunque se dispare.
    await pulsar(tree, 'carrito-item-mas-of-central-cafe');
    expect(leerCarrito(tree).items[0].cantidad).toBe(1);
  });

  it('muestra cuánto stock queda fuera del carrito y lo descuenta al comprar', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea({ stock: 5 }), 2);

    expect(texto(tree, 'carrito-item-stock-of-central-cafe')).toBe('Quedan 3 disponibles');

    await pulsar(tree, 'carrito-item-mas-of-central-cafe');

    expect(texto(tree, 'carrito-item-stock-of-central-cafe')).toBe('Quedan 2 disponibles');
  });

  it('avisa cuando la línea se llevó todo el stock de la oferta', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea({ stock: 5 }), 5);

    expect(texto(tree, 'carrito-item-stock-of-central-cafe')).toBe('Sin stock restante');
  });

  it('bajar de una unidad devuelve el stock restante al cálculo', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea({ stock: 5 }), 2);

    await pulsar(tree, 'carrito-item-menos-of-central-cafe');

    expect(texto(tree, 'carrito-item-stock-of-central-cafe')).toBe('Quedan 4 disponibles');
  });

  it('bajar de una unidad quita la línea, no la deja en cero', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());
    await agregar(tree, norte());

    await pulsar(tree, 'carrito-item-menos-of-central-cafe');

    expect(leerCarrito(tree).items).toHaveLength(1);
    expect(leerCarrito(tree).items[0].ofertaId).toBe('of-norte-cafe');
    expect(() => tree.root.findByProps({ testID: 'carrito-grupo-cafe-central' })).toThrow();
    expect(texto(tree, 'carrito-resumen-total')).toBe('$2.100');
  });

  it('borra la línea con la papelera, sin tocar el resto del grupo', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());
    await agregar(tree, linea({ ofertaId: 'of-central-te', productoNombre: 'Té Chai' }));
    await agregar(tree, norte());

    await pulsar(tree, 'carrito-item-quitar-of-central-te');

    expect(leerCarrito(tree).items.map((l: ItemCarrito) => l.ofertaId)).toEqual([
      'of-central-cafe',
      'of-norte-cafe',
    ]);
    expect(texto(tree, 'carrito-grupo-badge-cafe-central')).toBe('1 productos');
  });

  it('quitar la última línea devuelve el estado vacío', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());

    await pulsar(tree, 'carrito-item-quitar-of-central-cafe');

    expect(tree.root.findByProps({ testID: 'carrito-vacio' })).toBeTruthy();
    expect(texto(tree, 'carrito-origen')).toBe('Carrito sin productos');
    expect(() => tree.root.findByProps({ testID: 'carrito-pagar' })).toThrow();
  });

  it('refresca el precio si el catálogo cambió entre una agregado y otro', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());
    await agregar(tree, linea({ precioUnitario: 1950 }));

    // Es la misma línea (misma oferta): el carrito toma el precio nuevo, que es
    // el que está vivo en el catálogo, y acumula la unidad nueva.
    expect(leerCarrito(tree).items).toHaveLength(1);
    expect(leerCarrito(tree).items[0].cantidad).toBe(2);
    expect(texto(tree, 'carrito-item-of-central-cafe')).toContain('$1.950 c/u');
    expect(texto(tree, 'carrito-item-subtotal-of-central-cafe')).toBe('$3.900');
    expect(texto(tree, 'carrito-resumen-total')).toBe('$3.900');
  });
});

describe('El botón de pagar (INT4-35: lleva al checkout)', () => {
  it('lleva el total general en la etiqueta', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea(), 2);
    await agregar(tree, norte());

    expect(texto(tree, 'carrito-pagar')).toBe('Pagar con Mercado Pago $5.700');
  });

  it('navega a la pantalla de checkout, que es la que registra la compra', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());

    await pulsar(tree, 'carrito-pagar');

    // El carrito ya no habla con el backend ni abre Mercado Pago: registrar la
    // orden (POST /v1/compras) y abrir el checkout vive en la pantalla de
    // checkout (INT4-35). Acá solo se navega.
    expect(mockRouter.push).toHaveBeenCalledWith('/(cliente)/checkout');
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('muestra Mercado Pago como único método, ya elegido', async () => {
    const tree = await renderCarrito();
    await agregar(tree, linea());

    const metodo = textoDe(tree.root.findByProps({ testID: 'carrito-metodo-pago' }));
    expect(metodo).toContain('Mercado Pago');
    // Por ahora no hay alternativa: no hay control que pueda cambiar de método.
    expect(metodo).toContain('Tarjetas de débito, crédito o saldo en cuenta');
  });
});
