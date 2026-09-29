// src/__tests__/cliente-checkout.test.tsx
//
// Cubre la pantalla de checkout (INT4-35): el paso entre el carrito y Mercado
// Pago. Acá la app deja de hablar solo con el estado en memoria y manda la
// compra de verdad: POST /v1/compras con las líneas del carrito, y recién al
// recibir el initPoint abre el checkout de Mercado Pago. Lo que se prueba:
//   - el resumen que ve el usuario (grupos por cafetería, total, unidades),
//   - que el payload que viaja es solo ofertaId y cantidad (el precio lo fija
//     el backend, no la app),
//   - que el carrito se vacía cuando la orden ya existe del lado del servidor,
//   - las tres salidas: checkout de MP abierto, sin initPoint (revisión), y
//     usuario que cierra el navegador,
//   - el error normalizado con reintento cuando el backend no responde.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import CheckoutScreen from '../app/(cliente)/checkout';
import { CarritoProvider, useCarrito } from '../context/CarritoContext';
import { abrirCheckoutMercadoPago, crearCompra, parsearRetornoPago } from '../services/pagos';
import { getAccessToken } from '../services/httpClient';
import type { NuevoItemCarrito } from '../types/domain';

// El provider se monta real (no mockeado) para que la pantalla vea de verdad
// los grupos y el total que calcula el carrito. AuthContext se mockea porque el
// provider solo necesita saber quién tiene la sesión abierta.
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
  get router() {
    return mockRouter;
  },
  useRouter: jest.fn(() => mockRouter),
  useFocusEffect: jest.fn(),
}));

// Servicios de pago mockeados: la pantalla orquesta llamadas, no las
// implementa. Los default permiten el camino feliz y cada test los afina.
jest.mock('../services/pagos', () => ({
  crearCompra: jest.fn(async () => ({
    compraId: 'cmp-1',
    estado: 'pendiente de pago',
    initPoint: 'https://checkout.mp.test/iniciar',
    montoTotal: 6000,
  })),
  abrirCheckoutMercadoPago: jest.fn(async () => ({
    tipo: 'retorno_recibido',
    url: 'cloudcoffee://pago/retorno?status=approved&payment_id=pay-1&external_reference=cmp-1',
  })),
  parsearRetornoPago: jest.fn(() => ({ estado: 'exitoso', paymentId: 'pay-1', compraId: 'cmp-1' })),
}));

// Solo se reemplaza getAccessToken: toApiError y ApiProblem siguen siendo los
// reales para que el camino de error pruebe la normalización de verdad.
jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn(() => 'token-de-prueba') };
});

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View: RNView } = jest.requireActual('react-native');
  return {
    SafeAreaView: (props: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(RNView, props, props.children),
  };
});

const mockCrearCompra = crearCompra as unknown as jest.Mock;
const mockAbrirCheckout = abrirCheckoutMercadoPago as unknown as jest.Mock;
const mockParsearRetorno = parsearRetornoPago as unknown as jest.Mock;
const mockGetAccessToken = getAccessToken as unknown as jest.Mock;

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

type ValorCarrito = ReturnType<typeof useCarrito>;

// La sonda deja el carrito en las props de un nodo (mismo truco que los tests
// del contexto): así el test puede leer items/total/vaciar sin mockear nada.
function Sonda() {
  const valor = useCarrito();
  return <View testID="carrito-sonda" {...valor} />;
}

function montar(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <CarritoProvider>
        <Sonda />
        <CheckoutScreen />
      </CarritoProvider>
    );
  });
  return tree;
}

function leerCarrito(tree: ReactTestRenderer): ValorCarrito {
  return tree.root.findAllByProps({ testID: 'carrito-sonda' })[0].props as ValorCarrito;
}

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
  const boton = tree.root.findByProps({ testID });
  // onPress de esta pantalla es una async function: se espera a que termine
  // para que las llamadas encadenadas (crearCompra → vaciar → abrirCheckout →
  // router.replace) hayan corrido cuando el test mira el resultado.
  await act(async () => {
    await boton.props.onPress();
  });
}

function textoDe(nodo: ReactTestInstance): string {
  // Recorre los hijos en orden de render juntando los strings: sirve tanto para
  // un Text directo como para una tarjeta entera (la View del error trae varios
  // Text adentro y el test no tiene por qué conocer su estructura interna).
  const partes: string[] = [];
  const recolectar = (n: ReactTestInstance): void => {
    for (const hijo of n.children) {
      if (typeof hijo === 'string' || typeof hijo === 'number') {
        partes.push(String(hijo));
      } else {
        recolectar(hijo);
      }
    }
  };
  recolectar(nodo);
  return partes.join('');
}

function texto(tree: ReactTestRenderer, testID: string): string {
  return textoDe(tree.root.findByProps({ testID }));
}

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
  mockRouter.replace.mockClear();
  mockCrearCompra.mockClear();
  mockAbrirCheckout.mockClear();
  mockParsearRetorno.mockClear();
  mockGetAccessToken.mockClear();
  mockGetAccessToken.mockReturnValue('token-de-prueba');
  mockCrearCompra.mockResolvedValue({
    compraId: 'cmp-1',
    estado: 'pendiente de pago',
    initPoint: 'https://checkout.mp.test/iniciar',
    montoTotal: 6000,
  });
  mockAbrirCheckout.mockResolvedValue({
    tipo: 'retorno_recibido',
    url: 'cloudcoffee://pago/retorno?status=approved&payment_id=pay-1&external_reference=cmp-1',
  });
  mockParsearRetorno.mockReturnValue({ estado: 'exitoso', paymentId: 'pay-1', compraId: 'cmp-1' });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('Checkout (INT4-35)', () => {
  it('con el carrito vacío no ofrece confirmar y manda al catálogo', async () => {
    const tree = montar();

    // Sin productos no hay nada que confirmar: no debe existir el botón de
    // pagar, solo la invitación a volver al catálogo.
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-vacio' })).not.toThrow();

    await pulsar(tree, 'checkout-ir-catalogo');

    expect(mockRouter.replace).toHaveBeenCalledWith('/(cliente)');
  });

  it('muestra el resumen agrupado por cafetería con el total y las unidades', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await agregar(
      tree,
      linea({
        ofertaId: 'of-norte',
        cafeteriaId: 'cafe-norte',
        cafeteriaNombre: 'Cafetería Norte',
        precioUnitario: 2100,
      }),
      2
    );

    // 1 x 1.800 + 2 x 2.100
    expect(texto(tree, 'checkout-total')).toBe('$6.000');

    expect(tree.root.findByProps({ testID: 'checkout-grupo-cafe-central' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'checkout-grupo-cafe-norte' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'checkout-item-of-central-cafe' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'checkout-item-of-norte' })).toBeDefined();

    // El badge por grupo cuenta unidades, no líneas.
    expect(texto(tree, 'checkout-grupo-badge-cafe-central')).toBe('1 producto');
    expect(texto(tree, 'checkout-grupo-badge-cafe-norte')).toBe('2 productos');
    expect(texto(tree, 'checkout-grupo-subtotal-cafe-central')).toBe('$1.800');
    expect(texto(tree, 'checkout-grupo-subtotal-cafe-norte')).toBe('$4.200');
    expect(texto(tree, 'checkout-item-subtotal-of-norte')).toBe('$4.200');

    // El botón confirma con el total que ve el usuario.
    expect(texto(tree, 'checkout-confirmar-texto')).toBe('Confirmar y pagar $6.000');
  });

  it('al confirmar manda solo ofertaId y cantidad, vacía el carrito y navega al resultado', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await agregar(
      tree,
      linea({
        ofertaId: 'of-norte',
        cafeteriaId: 'cafe-norte',
        cafeteriaNombre: 'Cafetería Norte',
        precioUnitario: 2100,
      }),
      2
    );

    await pulsar(tree, 'checkout-confirmar');

    // El payload no lleva precio: lo recalcula el backend contra el catálogo.
    expect(mockCrearCompra).toHaveBeenCalledWith(
      [
        { ofertaId: 'of-central-cafe', cantidad: 1 },
        { ofertaId: 'of-norte', cantidad: 2 },
      ],
      'token-de-prueba'
    );

    // La orden ya existe del lado del servidor: el carrito no puede quedar
    // para pagar dos veces.
    expect(leerCarrito(tree).items).toEqual([]);

    expect(mockAbrirCheckout).toHaveBeenCalledWith('https://checkout.mp.test/iniciar');
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { estado: 'exitoso', compraId: 'cmp-1', paymentId: 'pay-1' },
    });
  });

  it('si el usuario cierra el navegador la compra queda pendiente y se avisa', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    mockAbrirCheckout.mockResolvedValue({ tipo: 'cerrado_sin_confirmar' });

    await pulsar(tree, 'checkout-confirmar');

    expect(mockAbrirCheckout).toHaveBeenCalledTimes(1);
    // La orden ya se creó antes de abrir el navegador: no se puede volver a
    // confirmar, así que se aclara que quedó pendiente. El carrito ya se vació.
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { estado: 'pendiente', compraId: 'cmp-1', paymentId: '' },
    });
    expect(leerCarrito(tree).items).toEqual([]);
  });

  it('sin initPoint la compra queda en revisión y se avisa como pendiente', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    mockCrearCompra.mockResolvedValue({
      compraId: 'cmp-2',
      estado: 'revisión requerida',
      initPoint: undefined,
      montoTotal: 1800,
    });

    await pulsar(tree, 'checkout-confirmar');

    // No hay checkout que abrir: el navegador no debe aparecer.
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { estado: 'pendiente', compraId: 'cmp-2', paymentId: '' },
    });
  });

  it('si el backend falla muestra el error normalizado y reintentar vuelve a intentar', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);

    // Primera llamada: el gateway no rutea /v1/compras todavía, esto es lo que
    // ve el usuario hoy. toApiError transforma el Error en ApiError con su
    // mensaje (sin response no hay problem+json que mostrar).
    mockCrearCompra.mockRejectedValue(new Error('boom'));

    await pulsar(tree, 'checkout-confirmar');

    const errorCard = tree.root.findByProps({ testID: 'checkout-error' });
    expect(errorCard).toBeDefined();
    expect(textoDe(errorCard)).toContain('boom');
    // El carrito NO se vacía cuando falla la creación: nada existió servidor.
    expect(leerCarrito(tree).items).toHaveLength(1);

    // El backend "se recupera": el reintento debe poder completar el flujo.
    mockCrearCompra.mockResolvedValue({
      compraId: 'cmp-1',
      estado: 'pendiente de pago',
      initPoint: 'https://checkout.mp.test/iniciar',
      montoTotal: 1800,
    });

    // El reintento usa el mismo carrito (que sigue ahí) y sale bien.
    await pulsar(tree, 'checkout-reintentar');

    expect(mockCrearCompra).toHaveBeenCalledTimes(2);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { estado: 'exitoso', compraId: 'cmp-1', paymentId: 'pay-1' },
    });
  });

  it('sin token activo no intenta la llamada y avisa que hay que iniciar sesión', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    mockGetAccessToken.mockReturnValue(null);

    await pulsar(tree, 'checkout-confirmar');

    expect(mockCrearCompra).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'checkout-error' })).toBeDefined();
    expect(textoDe(tree.root.findByProps({ testID: 'checkout-error' }))).toContain(
      'Tu sesión no está activa'
    );
  });
});
