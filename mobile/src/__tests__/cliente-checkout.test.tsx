// src/__tests__/cliente-checkout.test.tsx
//
// Cubre la pantalla de checkout (INT4-35): UNA sola pantalla, en línea con el
// mockup (paso "Pago & Revisión"), que además dice si la compra llegó al backend
// o no. Lo que se prueba:
//   - la revisión que ve el usuario (progreso de pasos, resumen agrupado por
//     cafetería, desglose de precios, datos de entrega y facturación validados,
//     método de pago, total),
//   - que el formulario valida antes de llamar al backend: sin los datos de
//     entrega completos no se dispara el POST,
//   - que el payload es solo ofertaId y cantidad (el precio lo fija el backend)
//     más los datos de entrega/facturación recopilados por la pantalla,
//   - que el carrito se vacía cuando la orden ya existe del lado del servidor,
//   - las salidas del éxito: con initPoint abre Mercado Pago en este flujo
//     (resultado-pago lo confirma), y sin initPoint la misma pantalla muestra
//     "¡Compra realizada!" (sin volver a cobrar),
//   - que la compra en estado "revisión requerida" (INT4-36) muestra la vista
//     "Tu compra está en revisión" en la misma pantalla, sin abrir Mercado
//     Pago ni ofrecer pagar de nuevo,
//   - que el fallo del backend (401/403 con mensaje de autenticación, u otro
//     error) pasa la MISMA pantalla a la vista de fallo, sin vaciar el carrito
//     y sin abrir Mercado Pago,
//   - las vistas de resultado por parámetro
//     (?estado=realizada|revision_requerida|fallo), que son las que permiten
//     demos y tests hoy (el backend aún no implementa el POST).
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
const mockParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRouter: jest.fn(() => mockRouter),
  useLocalSearchParams: jest.fn(() => mockParams),
  useFocusEffect: jest.fn(),
}));

// Los servicios de pago se mockean: la pantalla orquesta llamadas, no las
// implementa. Los defaults permiten el camino feliz y cada test los afina.
jest.mock('../services/pagos', () => ({
  abrirCheckoutMercadoPago: jest.fn(async () => ({
    tipo: 'retorno_recibido',
    url: 'cloudcoffee://pago/retorno?status=approved&payment_id=pay-1&external_reference=cmp-1',
  })),
  crearCompra: jest.fn(async () => ({
    compraId: 'cmp-1',
    estado: 'pendiente de pago',
    initPoint: 'https://checkout.mp.test/iniciar',
    montoTotal: 6000,
  })),
  parsearRetornoPago: jest.fn(() => ({
    estado: 'exitoso',
    paymentId: 'pay-1',
    compraId: 'cmp-1',
  })),
  // La constante que la pantalla usa para distinguir el estado INT4-36.
  ESTADO_COMPRA_REVISION_REQUERIDA: 'revisión requerida',
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

// Datos de entrega y facturación válidos, tal como el usuario los escribiría.
const FORM_VALIDO = {
  nombre: 'María Fernanda López',
  correo: 'maria@ca.cloudcoffee.cl',
  telefono: '+56912345678',
};

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

// Escribe un campo del formulario: el TextInput recibe el valor por onChangeText
// (la pantalla es de estado controlado, no hay refs ni DOM en el test).
async function escribir(tree: ReactTestRenderer, testID: string, valor: string): Promise<void> {
  const campo = tree.root.findByProps({ testID });
  await act(async () => {
    campo.props.onChangeText(valor);
  });
}

// Llena los tres campos obligatorios. Sin overrides el formulario queda válido:
// CloudCoffee solo retira en cafetería, así que no hay dirección que escribir.
async function llenarFormulario(
  tree: ReactTestRenderer,
  overrides: Partial<typeof FORM_VALIDO> = {}
): Promise<void> {
  const datos = { ...FORM_VALIDO, ...overrides };
  await escribir(tree, 'checkout-nombre', datos.nombre);
  await escribir(tree, 'checkout-correo', datos.correo);
  await escribir(tree, 'checkout-telefono', datos.telefono);
}

async function pulsar(tree: ReactTestRenderer, testID: string): Promise<void> {
  const boton = tree.root.findByProps({ testID });
  // onPress de esta pantalla es una async function: se espera a que termine
  // para que las llamadas encadenadas (crearCompra → abrirCheckout → replace)
  // hayan corrido cuando el test mira el resultado.
  await act(async () => {
    await boton.props.onPress();
  });
}

function textoDe(nodo: ReactTestInstance): string {
  // Recorre los hijos en orden de render juntando los strings: sirve tanto para
  // un Text directo como para una tarjeta entera.
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
  delete mockParams.estado;
  delete mockParams.mensaje;
  delete mockParams.compraId;
  delete mockParams.montoTotal;
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

  it('muestra la revisión con progreso, resumen, desglose, formulario y método de pago', async () => {
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

    // 1 x 1.800 + 2 x 2.100 = 6.000; con retiro en cafetería (por defecto) el
    // despacho es $0, así que el total a pagar es el subtotal.
    expect(texto(tree, 'checkout-total')).toBe('$6.000');

    // Progreso del mockup: 1. Carrito ✓ · 2. Información ✓ · 3. Pago & Revisión
    expect(texto(tree, 'checkout-progreso')).toContain('1. Carrito ✓');
    expect(texto(tree, 'checkout-progreso')).toContain('2. Información ✓');
    expect(texto(tree, 'checkout-progreso')).toContain('3. Pago & Revisión');

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

    // Desglose de precios: subtotal, despacho e impuestos.
    expect(texto(tree, 'checkout-desglose-subtotal')).toBe('$6.000');
    expect(texto(tree, 'checkout-desglose-despacho')).toBe('$0');
    expect(texto(tree, 'checkout-desglose-impuestos')).toBe('Incluidos');

    // Datos de entrega y facturación: retiro en cafetería y campos validados.
    expect(tree.root.findByProps({ testID: 'checkout-metodo-retiro' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'checkout-nombre' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'checkout-correo' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'checkout-telefono' })).toBeDefined();
    // No hay envío a domicilio, así que no hay dirección que pedir: se resume
    // dónde se retira.
    expect(texto(tree, 'checkout-entrega-detalle')).toContain('Retiro programado en 2 puntos');
    expect(() => tree.root.findByProps({ testID: 'checkout-direccion' })).toThrow();

    // Método de pago: pasarela integrada (la tarjeta se ingresa en Mercado Pago).
    expect(tree.root.findByProps({ testID: 'checkout-metodo-pago' })).toBeDefined();

    // El botón confirma con el total que ve el usuario, en estado de carga se
    // deshabilita para evitar dobles envíos.
    expect(texto(tree, 'checkout-confirmar-texto')).toBe('Confirmar y Pagar $6.000');
  });

  it('sin los datos de entrega no llama al backend y muestra los errores del formulario', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);

    // Se pulsa confirmar con el formulario vacío: la validación frena acá, no
    // hay POST (no se crea una orden a medias) y la revisión sigue visible.
    await pulsar(tree, 'checkout-confirmar');

    expect(mockCrearCompra).not.toHaveBeenCalled();
    expect(texto(tree, 'checkout-error-nombre')).toBe('Ingresa tu nombre completo.');
    expect(texto(tree, 'checkout-error-correo')).toBe('Ingresa un correo electrónico válido.');
    expect(texto(tree, 'checkout-error-telefono')).toBe(
      'Ingresa un teléfono válido (solo números).'
    );
    expect(() => tree.root.findByProps({ testID: 'checkout-procesando' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).not.toThrow();

    // Escribir en un campo limpia su error: el usuario lo está corrigiendo.
    await escribir(tree, 'checkout-nombre', FORM_VALIDO.nombre);
    expect(() => tree.root.findByProps({ testID: 'checkout-error-nombre' })).toThrow();
  });

  it('al confirmar manda solo ofertaId y cantidad más los datos, vacía y abre Mercado Pago', async () => {
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
    await llenarFormulario(tree);

    await pulsar(tree, 'checkout-confirmar');

    // El payload no lleva precio: lo recalcula el backend contra el catálogo, y
    // viaja con los datos de entrega/facturación recopilados por la pantalla.
    expect(mockCrearCompra).toHaveBeenCalledWith(
      [
        { ofertaId: 'of-central-cafe', cantidad: 1 },
        { ofertaId: 'of-norte', cantidad: 2 },
      ],
      'token-de-prueba',
      {
        nombre: FORM_VALIDO.nombre,
        correo: FORM_VALIDO.correo,
        telefono: FORM_VALIDO.telefono,
        metodoEntrega: 'retiro',
      }
    );

    // La orden ya existe del lado del servidor: el carrito no puede quedar
    // para pagar dos veces.
    expect(leerCarrito(tree).items).toEqual([]);

    // El pago se hace en este flujo: el checkout abre Mercado Pago con el
    // initPoint que devolvió el backend (la vista de resultado no vuelve a
    // cobrar) y resultado-pago lo confirma al volver del navegador.
    expect(mockAbrirCheckout).toHaveBeenCalledWith('https://checkout.mp.test/iniciar');
    expect(mockParsearRetorno).toHaveBeenCalledWith(
      'cloudcoffee://pago/retorno?status=approved&payment_id=pay-1&external_reference=cmp-1'
    );
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { estado: 'exitoso', compraId: 'cmp-1', paymentId: 'pay-1' },
    });
  });

  it('no ofrece envío a domicilio: ni método, ni dirección, ni despacho', async () => {
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

    // El retiro es el único método: se informa, no se elige.
    expect(texto(tree, 'checkout-desglose-despacho')).toBe('$0');
    expect(texto(tree, 'checkout-total')).toBe('$6.000');
    expect(() => tree.root.findByProps({ testID: 'checkout-metodo-envio' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-direccion' })).toThrow();

    // Y el pedido sale siempre como retiro, sin dirección.
    await llenarFormulario(tree);
    await pulsar(tree, 'checkout-confirmar');

    expect(mockCrearCompra).toHaveBeenCalledWith(
      [
        { ofertaId: 'of-central-cafe', cantidad: 1 },
        { ofertaId: 'of-norte', cantidad: 2 },
      ],
      'token-de-prueba',
      {
        nombre: FORM_VALIDO.nombre,
        correo: FORM_VALIDO.correo,
        telefono: FORM_VALIDO.telefono,
        metodoEntrega: 'retiro',
      }
    );
  });

  it('sin initPoint la misma pantalla muestra la compra realizada, sin volver a cobrar', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    mockCrearCompra.mockResolvedValue({
      compraId: 'cmp-2',
      estado: 'pendiente de pago',
      initPoint: undefined,
      montoTotal: 1800,
    });
    await llenarFormulario(tree);

    await pulsar(tree, 'checkout-confirmar');

    // La compra llegó y quedó registrada: la vista "realizada" de la misma
    // pantalla lo confirma. No hay navegación, no se abre Mercado Pago y no
    // hay botón que vuelva a cobrar.
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(texto(tree, 'checkout-realizada-titulo')).toBe('¡Compra realizada!');
    expect(texto(tree, 'checkout-realizada-compra')).toBe('cmp-2');
    expect(texto(tree, 'checkout-realizada-total')).toBe('$1.800');
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).toThrow();
    expect(leerCarrito(tree).items).toEqual([]);
  });

  it('si el backend responde estado revisión requerida muestra la compra en revisión (INT4-36)', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    mockCrearCompra.mockResolvedValue({
      compraId: 'cmp-rev',
      estado: 'revisión requerida',
      // Aunque viniera un initPoint, una compra en revisión no abre Mercado
      // Pago: todavía no se puede cobrar.
      initPoint: 'https://checkout.mp.test/revision',
      montoTotal: 1800,
    });
    await llenarFormulario(tree);

    await pulsar(tree, 'checkout-confirmar');

    // La compra llegó (el carrito se vació) pero quedó en revisión: ni
    // "realizada" ni fallo, no se abre Mercado Pago, no se navega y no hay
    // botón que vuelva a cobrar.
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(texto(tree, 'checkout-revision-requerida-titulo')).toBe('Tu compra está en revisión');
    expect(texto(tree, 'checkout-revision-requerida-compra')).toBe('cmp-rev');
    expect(texto(tree, 'checkout-revision-requerida-total')).toBe('$1.800');
    expect(texto(tree, 'checkout-revision-requerida-mensaje')).toContain('No se cobrará de nuevo');
    expect(() => tree.root.findByProps({ testID: 'checkout-realizada' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-fallo' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).toThrow();
    expect(leerCarrito(tree).items).toEqual([]);
  });

  it('si el usuario cierra el navegador sin confirmar la compra queda pendiente', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);
    mockAbrirCheckout.mockResolvedValue({ tipo: 'cerrado_sin_confirmar' });

    await pulsar(tree, 'checkout-confirmar');

    // La orden ya quedó creada (el carrito se vació al crearla): se avisa como
    // pendiente y no se vuelve al checkout a confirmar de nuevo.
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { estado: 'pendiente', compraId: 'cmp-1', paymentId: '' },
    });
  });

  it('si el backend responde 500 la misma pantalla pasa al fallo sin vaciar el carrito', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);

    // El gateway no rutea /v1/compras todavía, esto es lo que ve el usuario
    // hoy. toApiError transforma el Error en ApiError con su mensaje.
    mockCrearCompra.mockRejectedValue(new Error('boom'));

    await pulsar(tree, 'checkout-confirmar');

    // Nada se registró del lado del servidor: la MISMA pantalla muestra la
    // vista de fallo (no hay navegación a una ruta aparte ni alerta), el
    // carrito queda intacto y no se abre el pago (no hay initPoint).
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(texto(tree, 'checkout-fallo-titulo')).toBe('No pudimos realizar tu compra');
    expect(texto(tree, 'checkout-fallo-mensaje')).toContain('boom');
    expect(texto(tree, 'checkout-fallo-aviso')).toContain('Nada se cobró');
    expect(leerCarrito(tree).items).toHaveLength(1);
  });

  it('un 401 muestra el fallo con el mensaje de autenticación de la especificación', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);

    // El backend responde 401 (problem+json con detail): toApiError lo clasifica
    // y la pantalla muestra el mensaje de autenticación especificado.
    mockCrearCompra.mockRejectedValue({
      response: {
        status: 401,
        data: { detail: 'Se requiere autenticación válida para acceder a este recurso.' },
      },
    });

    await pulsar(tree, 'checkout-confirmar');

    expect(texto(tree, 'checkout-fallo-mensaje')).toBe(
      'Se requiere autenticación válida para acceder a este recurso. Nada se cobró y tu carrito sigue listo.'
    );
    expect(texto(tree, 'checkout-fallo-aviso')).toContain('Nada se cobró');
    expect(leerCarrito(tree).items).toHaveLength(1);
  });

  it('sin token activo no intenta la llamada y muestra el fallo con el mensaje de sesión', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);
    mockGetAccessToken.mockReturnValue(null);

    await pulsar(tree, 'checkout-confirmar');

    expect(mockCrearCompra).not.toHaveBeenCalled();
    expect(texto(tree, 'checkout-fallo-mensaje')).toBe(
      'Se requiere autenticación válida para acceder a este recurso. Nada se cobró y tu carrito sigue listo.'
    );
    expect(leerCarrito(tree).items).toHaveLength(1);
  });

  it('vista realizada por parámetro muestra compra y total, y no ofrece pagar de nuevo', async () => {
    mockParams.estado = 'realizada';
    mockParams.compraId = 'cmp-demo';
    mockParams.montoTotal = '8400';

    const tree = montar();

    expect(texto(tree, 'checkout-realizada-titulo')).toBe('¡Compra realizada!');
    expect(texto(tree, 'checkout-realizada-compra')).toBe('cmp-demo');
    expect(texto(tree, 'checkout-realizada-total')).toBe('$8.400');
    expect(texto(tree, 'checkout-realizada-mensaje')).toContain('No es necesario volver a pagar');
    // La pantalla solo verifica el estado: no hay botón que vuelva a cobrar.
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).toThrow();

    await pulsar(tree, 'checkout-realizada-ir-compras');
    expect(mockRouter.replace).toHaveBeenCalledWith('/mis-compras');

    await pulsar(tree, 'checkout-realizada-volver-catalogo');
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('vista en revisión por parámetro muestra la compra y permite ir a Mis compras', async () => {
    mockParams.estado = 'revision_requerida';
    mockParams.compraId = 'cmp-rev';
    mockParams.montoTotal = '8400';

    const tree = montar();

    expect(texto(tree, 'checkout-revision-requerida-titulo')).toBe('Tu compra está en revisión');
    expect(texto(tree, 'checkout-revision-requerida-compra')).toBe('cmp-rev');
    expect(texto(tree, 'checkout-revision-requerida-total')).toBe('$8.400');
    expect(texto(tree, 'checkout-revision-requerida-mensaje')).toContain('No se cobrará de nuevo');
    // La pantalla solo muestra el resultado: no hay botón que vuelva a cobrar.
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).toThrow();

    await pulsar(tree, 'checkout-revision-requerida-ir-compras');
    expect(mockRouter.replace).toHaveBeenCalledWith('/mis-compras');

    mockParams.estado = 'revision_requerida';
    mockParams.compraId = 'cmp-rev';
    mockParams.montoTotal = '8400';
    const tree2 = montar();
    await pulsar(tree2, 'checkout-revision-requerida-volver-catalogo');
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('vista fallo por parámetro permite reintentar (vuelve a la revisión) o volver al carrito', async () => {
    mockParams.estado = 'fallo';
    mockParams.mensaje = 'se cayó la red';

    const tree = montar();
    await agregar(tree, linea(), 1);

    expect(texto(tree, 'checkout-fallo-titulo')).toBe('No pudimos realizar tu compra');
    expect(texto(tree, 'checkout-fallo-mensaje')).toContain('se cayó la red');
    // El carrito sigue intacto: reintentar vuelve a mostrar la revisión.
    await pulsar(tree, 'checkout-fallo-reintentar');
    expect(() => tree.root.findByProps({ testID: 'checkout-fallo' })).toThrow();
    expect(texto(tree, 'checkout-total')).toBe('$1.800');
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).not.toThrow();

    // Y desde el fallo también se puede volver al carrito.
    mockParams.estado = 'fallo';
    mockParams.mensaje = 'se cayó la red';
    const tree2 = montar();
    await pulsar(tree2, 'checkout-fallo-volver-carrito');
    expect(mockRouter.replace).toHaveBeenCalledWith('/carrito');
  });
});
