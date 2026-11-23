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
//   - que el carrito se vacía solo cuando Order aprueba el pago (INT4-128):
//     con rechazo o pendiente el carrito queda intacto para reintentar,
//   - que el resultado del pago NO se elige en la pantalla: se envía el
//     escenario fijo del despliegue y se navega al resultado con compraId y
//     pagoId, sin Mercado Pago ni navegador externo,
//   - que la compra en estado "revisión requerida" (INT4-36) muestra la vista
//     "Tu compra está en revisión" en la misma pantalla, sin simular pago ni
//     ofrecer pagar de nuevo,
//   - que el fallo del backend (401/403 con mensaje de autenticación, u otro
//     error) pasa la MISMA pantalla a la vista de fallo, sin vaciar el carrito
//     y sin llamar al pago simulado,
//   - las vistas de resultado por parámetro
//     (?estado=realizada|revision_requerida|fallo), que son las que permiten
//     demos y tests hoy (el backend aún no implementa el POST).
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import CheckoutScreen from '../app/(cliente)/checkout';
import { ESCENARIO_PAGO_CLIENTE } from '../config/pagoSimulado';
import { CarritoProvider, useCarrito } from '../context/CarritoContext';
import {
  abrirCheckoutMercadoPago,
  consultarPago,
  crearCompra,
  parsearRetornoPago,
  simularPago,
} from '../services/pagos';
import { obtenerPerfil } from '../services/auth';
import { ApiError, getAccessToken } from '../services/httpClient';
import { desmontar, escribir, limpiarRouter, pulsar, routerMock, texto } from '../test-utils';
import type { NuevoItemCarrito, PerfilUsuario } from '../types/domain';

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

const mockParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

// INT4-130: la intención se persiste en AsyncStorage; en Jest se usa el mock
// del proyecto (no existe el módulo nativo).
jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

// Los servicios de pago se mockean: la pantalla orquesta llamadas, no las
// implementa. Los defaults permiten el camino feliz y cada test los afina.
jest.mock('../services/pagos', () => ({
  abrirCheckoutMercadoPago: jest.fn(async () => ({
    tipo: 'retorno_recibido',
    url: 'cloudcoffee://pago/retorno?status=approved&payment_id=pay-1&external_reference=cmp-1',
  })),
  crearCompra: jest.fn(async () => ({
    compraId: 'cmp-1',
    estado: 'pendiente_pago',
    montoTotal: 6000,
  })),
  simularPago: jest.fn(async () => ({
    pagoId: 'pago-1',
    compraId: 'cmp-1',
    estado: 'aprobado',
    motivo: 'aprobacion_simulada',
    montoTotal: 6000,
    moneda: 'CLP',
    simulado: true,
    proveedor: 'simulado',
    creadoAt: '2026-01-01T00:00:00Z',
    actualizadoAt: '2026-01-01T00:00:00Z',
    version: 1,
  })),
  parsearRetornoPago: jest.fn(() => ({
    estado: 'exitoso',
    paymentId: 'pay-1',
    compraId: 'cmp-1',
  })),
  // INT4-130: por defecto no hay pago (404) y se configura por test.
  consultarPago: jest.fn(),
  // La clave se genera con la implementación real para que las aserciones
  // comprueben un UUID v4 de verdad.
  generarIdempotencyKey: jest.requireActual('../services/pagos').generarIdempotencyKey,
  // La constante que la pantalla usa para distinguir el estado INT4-36.
  ESTADO_COMPRA_REVISION_REQUERIDA: 'revisión requerida',
}));

// A2 (INT4-127): el perfil se mockea aparte. Por defecto queda pendiente para
// no alterar los tests históricos del formulario vacío; cada test de precarga
// define su propia respuesta.
jest.mock('../services/auth', () => ({
  obtenerPerfil: jest.fn(),
}));

// Solo se reemplaza getAccessToken: toApiError y ApiProblem siguen siendo los
// reales para que el camino de error pruebe la normalización de verdad.
jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn(() => 'token-de-prueba') };
});

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);

const mockCrearCompra = crearCompra as unknown as jest.Mock;
const mockSimularPago = simularPago as unknown as jest.Mock;
const mockConsultarPago = consultarPago as unknown as jest.Mock;
const mockAbrirCheckout = abrirCheckoutMercadoPago as unknown as jest.Mock;
const mockParsearRetorno = parsearRetornoPago as unknown as jest.Mock;
const mockObtenerPerfil = obtenerPerfil as unknown as jest.Mock;
const mockGetAccessToken = getAccessToken as unknown as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;
const mockGetItem = AsyncStorage.getItem as unknown as jest.Mock;
const mockSetItem = AsyncStorage.setItem as unknown as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as unknown as jest.Mock;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAVE_GUARDADA = '123e4567-e89b-42d3-a456-426614174000';

// Datos de entrega y facturación válidos, tal como el usuario los escribiría.
const FORM_VALIDO = {
  nombre: 'María Fernanda López',
  correo: 'maria@ca.cloudcoffee.cl',
  telefono: '+56912345678',
};

// A2 (INT4-127): respuesta de GET /v1/auth/users/me. El nombre completo del
// checkout se arma con nombre + apellido del perfil.
const PERFIL: PerfilUsuario = {
  id: 'user-1',
  email: FORM_VALIDO.correo,
  nombre: 'María Fernanda',
  apellido: 'López',
  telefono: FORM_VALIDO.telefono,
  rol: 'CLIENTE',
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

// Igual que montar(), pero espera a que se resuelva la lectura de la
// intención persistida (useEffect) antes de devolver el árbol.
async function montarConEspera(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
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

function valorCampo(tree: ReactTestRenderer, testID: string): string {
  return tree.root.findByProps({ testID }).props.value as string;
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

async function llenarFormulario(
  tree: ReactTestRenderer,
  overrides: Partial<typeof FORM_VALIDO> = {}
): Promise<void> {
  const datos = { ...FORM_VALIDO, ...overrides };
  await escribir(tree, 'checkout-nombre', datos.nombre);
  await escribir(tree, 'checkout-correo', datos.correo);
  await escribir(tree, 'checkout-telefono', datos.telefono);
}

beforeEach(() => {
  limpiarRouter();
  mockUseLocalSearchParams.mockReturnValue(mockParams);
  mockObtenerPerfil.mockReset();
  // Los tests históricos arrancan con el formulario vacío: la consulta queda
  // pendiente y no modifica el árbol fuera de `act`.
  mockObtenerPerfil.mockImplementation(() => new Promise(() => {}));
  mockCrearCompra.mockClear();
  mockSimularPago.mockClear();
  mockConsultarPago.mockClear();
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
  mockGetItem.mockResolvedValue(null);
  mockConsultarPago.mockRejectedValue(new ApiError('PAGO_NO_ENCONTRADO', 404));
  mockAbrirCheckout.mockClear();
  mockParsearRetorno.mockClear();
  mockGetAccessToken.mockClear();
  mockGetAccessToken.mockReturnValue('token-de-prueba');
  mockCrearCompra.mockResolvedValue({
    compraId: 'cmp-1',
    estado: 'pendiente_pago',
    montoTotal: 6000,
  });
  mockSimularPago.mockResolvedValue({
    pagoId: 'pago-1',
    compraId: 'cmp-1',
    estado: 'aprobado',
    motivo: 'aprobacion_simulada',
    montoTotal: 6000,
    moneda: 'CLP',
    simulado: true,
    proveedor: 'simulado',
    creadoAt: '2026-01-01T00:00:00Z',
    actualizadoAt: '2026-01-01T00:00:00Z',
    version: 1,
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

    expect(routerMock.replace).toHaveBeenCalledWith('/(cliente)');
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

    // Método de pago (INT4-128/131): pago de Order, SIN selector de resultado.
    // El cliente no puede decidir si se aprueba, se rechaza o queda pendiente:
    // eso lo resuelve Order con el estado real de la compra. Tampoco se le
    // muestra que el cobro es simulado ni que antes se usaba Mercado Pago.
    expect(texto(tree, 'checkout-metodo-pago')).toContain('Confirmación de pago');
    expect(texto(tree, 'checkout-metodo-pago')).toContain('Confirmamos el resultado');
    expect(texto(tree, 'checkout-metodo-pago')).not.toContain('simulado');
    expect(texto(tree, 'checkout-metodo-pago')).not.toContain('Mercado Pago');
    expect(texto(tree, 'checkout-nota')).not.toContain('simula');
    expect(() => tree.root.findByProps({ testID: 'checkout-escenario-aprobar' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-escenario-rechazar' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-escenario-pendiente' })).toThrow();

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

  it('al confirmar crea la compra, simula el pago configurado y navega al resultado', async () => {
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

    // El escenario es configuración del despliegue, no una decisión del usuario
    // ni un estado inventado por la app: viaja al pago simulado de Order.
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
    expect(mockSimularPago).toHaveBeenCalledWith(
      'cmp-1',
      ESCENARIO_PAGO_CLIENTE,
      expect.stringMatching(UUID_V4)
    );

    // INT4-130: el pago existente se consulta ANTES de simular.
    expect(mockConsultarPago).toHaveBeenCalledWith('cmp-1');
    expect(mockConsultarPago.mock.invocationCallOrder[0]).toBeLessThan(
      mockSimularPago.mock.invocationCallOrder[0]
    );

    // Pago aprobado: recién acá el carrito se convierte en compra concretada.
    expect(leerCarrito(tree).items).toEqual([]);

    // Sin Mercado Pago, sin initPoint y sin navegador externo: la pantalla de
    // resultado consulta el estado real con el compraId.
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(mockParsearRetorno).not.toHaveBeenCalled();
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-1' },
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

  it('si Order rechaza el pago conserva el carrito para poder volver a intentar', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    mockSimularPago.mockResolvedValue({
      pagoId: 'pago-rechazado',
      compraId: 'cmp-1',
      estado: 'rechazado',
      motivo: 'rechazo_simulado',
      montoTotal: 1800,
      moneda: 'CLP',
      simulado: true,
      proveedor: 'simulado',
      creadoAt: '2026-01-01T00:00:00Z',
      actualizadoAt: '2026-01-01T00:00:00Z',
      version: 1,
    });
    await llenarFormulario(tree);

    await pulsar(tree, 'checkout-confirmar');

    expect(mockSimularPago).toHaveBeenCalledWith(
      'cmp-1',
      ESCENARIO_PAGO_CLIENTE,
      expect.stringMatching(UUID_V4)
    );
    // El resultado-pago ofrecerá volver al carrito: no puede estar vacío.
    expect(leerCarrito(tree).items).toHaveLength(1);
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-rechazado' },
    });
  });

  it('si Order deja el pago pendiente conserva el carrito y va al seguimiento', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    mockSimularPago.mockResolvedValue({
      pagoId: 'pago-pendiente',
      compraId: 'cmp-1',
      estado: 'pendiente',
      motivo: 'escenario_pendiente',
      montoTotal: 1800,
      moneda: 'CLP',
      simulado: true,
      proveedor: 'simulado',
      creadoAt: '2026-01-01T00:00:00Z',
      actualizadoAt: '2026-01-01T00:00:00Z',
      version: 1,
    });
    await llenarFormulario(tree);

    await pulsar(tree, 'checkout-confirmar');

    expect(mockSimularPago).toHaveBeenCalledWith(
      'cmp-1',
      ESCENARIO_PAGO_CLIENTE,
      expect.stringMatching(UUID_V4)
    );
    expect(leerCarrito(tree).items).toHaveLength(1);
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-pendiente' },
    });
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
    // "realizada" ni fallo, no se simula pago, no se abre Mercado Pago, no se
    // navega y no hay botón que vuelva a cobrar.
    expect(mockSimularPago).not.toHaveBeenCalled();
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(texto(tree, 'checkout-revision-requerida-titulo')).toBe('Tu compra está en revisión');
    expect(texto(tree, 'checkout-revision-requerida-compra')).toBe('cmp-rev');
    expect(texto(tree, 'checkout-revision-requerida-total')).toBe('$1.800');
    expect(texto(tree, 'checkout-revision-requerida-mensaje')).toContain('No se cobrará de nuevo');
    expect(() => tree.root.findByProps({ testID: 'checkout-realizada' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-fallo' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).toThrow();
    expect(leerCarrito(tree).items).toEqual([]);
  });

  it('si falla el pago simulado muestra el fallo y conserva el carrito', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);
    mockSimularPago.mockRejectedValue(new Error('pago no disponible'));

    await pulsar(tree, 'checkout-confirmar');

    // La compra se creó pero Order no pudo confirmar el cobro: no se afirma un
    // pago aprobado, no se vacía el carrito y la pantalla muestra el fallo.
    expect(mockSimularPago).toHaveBeenCalledWith(
      'cmp-1',
      ESCENARIO_PAGO_CLIENTE,
      expect.stringMatching(UUID_V4)
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(texto(tree, 'checkout-fallo-titulo')).toBe('No pudimos realizar tu compra');
    expect(texto(tree, 'checkout-fallo-mensaje')).toContain('pago no disponible');
    expect(leerCarrito(tree).items).toHaveLength(1);
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
    expect(mockSimularPago).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
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
    expect(mockSimularPago).not.toHaveBeenCalled();
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
    expect(routerMock.replace).toHaveBeenCalledWith('/mis-compras');

    await pulsar(tree, 'checkout-realizada-volver-catalogo');
    expect(routerMock.replace).toHaveBeenCalledWith('/');
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
    expect(routerMock.replace).toHaveBeenCalledWith('/mis-compras');

    mockParams.estado = 'revision_requerida';
    mockParams.compraId = 'cmp-rev';
    mockParams.montoTotal = '8400';
    const tree2 = montar();
    await pulsar(tree2, 'checkout-revision-requerida-volver-catalogo');
    expect(routerMock.replace).toHaveBeenCalledWith('/');
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
    expect(routerMock.replace).toHaveBeenCalledWith('/carrito');
  });

  it('INT4-130/131: reabrir conserva la clave y reintenta con el escenario configurado', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        compraId: 'cmp-1',
        idempotencyKey: CLAVE_GUARDADA,
        escenario: 'rechazar',
      })
    );

    const tree = await montarConEspera();
    await agregar(tree, linea(), 1);

    // Reabrir consulta primero el pago existente y recupera la clave, sin
    // revivir el escenario 'rechazar' de una versión anterior de la pantalla.
    expect(mockConsultarPago).toHaveBeenCalledWith('cmp-1');
    expect(tree.root.findByProps({ testID: 'checkout-intencion-recuperada' })).toBeDefined();

    await llenarFormulario(tree);
    await pulsar(tree, 'checkout-confirmar');

    expect(mockCrearCompra).not.toHaveBeenCalled();
    expect(mockSimularPago).toHaveBeenCalledWith('cmp-1', ESCENARIO_PAGO_CLIENTE, CLAVE_GUARDADA);
    expect(mockSetItem).toHaveBeenCalledWith(
      expect.stringContaining('intencion-pago'),
      expect.stringContaining(CLAVE_GUARDADA)
    );

    desmontar(tree);
  });

  it('INT4-130: con pago pendiente ya creado va al resultado sin simular de nuevo', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        compraId: 'cmp-1',
        idempotencyKey: CLAVE_GUARDADA,
        escenario: 'pendiente',
      })
    );
    mockConsultarPago.mockResolvedValue({
      pagoId: 'pago-pendiente',
      compraId: 'cmp-1',
      estado: 'pendiente',
    });

    const tree = await montarConEspera();

    expect(mockCrearCompra).not.toHaveBeenCalled();
    expect(mockSimularPago).not.toHaveBeenCalled();
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-pendiente' },
    });

    desmontar(tree);
  });

  it('INT4-130: con pago terminal ya creado muestra el estado real y cierra la intención', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({
        compraId: 'cmp-1',
        idempotencyKey: CLAVE_GUARDADA,
        escenario: 'aprobar',
      })
    );
    mockConsultarPago.mockResolvedValue({
      pagoId: 'pago-aprobado',
      compraId: 'cmp-1',
      estado: 'aprobado',
    });

    const tree = await montarConEspera();

    expect(mockCrearCompra).not.toHaveBeenCalled();
    expect(mockSimularPago).not.toHaveBeenCalled();
    expect(mockConsultarPago).toHaveBeenCalledWith('cmp-1');
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-aprobado' },
    });
    expect(mockRemoveItem).toHaveBeenCalledWith(expect.stringContaining('intencion-pago'));

    desmontar(tree);
  });

  it('INT4-130/131: al confirmar se persiste la clave con el escenario configurado', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);
    await pulsar(tree, 'checkout-confirmar');

    const llamada = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
    const guardado = JSON.parse(llamada[1]);
    expect(guardado.escenario).toBe(ESCENARIO_PAGO_CLIENTE);
    expect(guardado.idempotencyKey).toMatch(UUID_V4);
    expect(guardado.compraId).toBe('cmp-1');

    desmontar(tree);
  });

  it('INT4-131: timeout conserva la clave; al reabrir reintenta sin crear otra compra', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);
    // Timeout = error sin `response`: toApiError lo deja con status 0. El
    // backend pudo haber iniciado el pago, así que nada se puede afirmar.
    mockSimularPago.mockRejectedValueOnce(new Error('Network Error'));

    await pulsar(tree, 'checkout-confirmar');

    expect(texto(tree, 'checkout-fallo-titulo')).toBe('No pudimos realizar tu compra');
    expect(texto(tree, 'checkout-fallo-mensaje')).toContain('Network Error');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(leerCarrito(tree).items).toHaveLength(1);

    const escrito = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1];
    const guardado = JSON.parse(escrito[1]);
    expect(guardado).toMatchObject({
      compraId: 'cmp-1',
      escenario: ESCENARIO_PAGO_CLIENTE,
      idempotencyKey: expect.stringMatching(UUID_V4),
    });
    desmontar(tree);

    // Reapertura: AsyncStorage devuelve EXACTAMENTE la intención del timeout.
    mockGetItem.mockResolvedValue(JSON.stringify(guardado));
    limpiarRouter();
    const reabierto = await montarConEspera();
    await agregar(reabierto, linea(), 1);

    expect(mockConsultarPago).toHaveBeenCalledWith('cmp-1');
    expect(() =>
      reabierto.root.findByProps({ testID: 'checkout-intencion-recuperada' })
    ).not.toThrow();

    await llenarFormulario(reabierto);
    await pulsar(reabierto, 'checkout-confirmar');

    // No se crea otra compra y se reutilizan clave y escenario configurado:
    // cambiar cualquiera de los dos daría 409 PAGO_YA_INICIADO.
    expect(mockCrearCompra).toHaveBeenCalledTimes(1);
    expect(mockSimularPago).toHaveBeenLastCalledWith(
      'cmp-1',
      ESCENARIO_PAGO_CLIENTE,
      guardado.idempotencyKey
    );
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-1' },
    });
    expect(mockAbrirCheckout).not.toHaveBeenCalled();

    desmontar(reabierto);
  });

  it('INT4-131: 409 PAGO_YA_INICIADO muestra el detail del Problem Details sin confirmar pago', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);
    mockSimularPago.mockRejectedValue({
      response: {
        status: 409,
        data: {
          type: 'about:blank',
          title: 'Conflicto',
          status: 409,
          detail: 'La compra ya tiene un pago iniciado.',
          code: 'PAGO_YA_INICIADO',
          traceId: 'trace-int4-131',
        },
      },
    });

    await pulsar(tree, 'checkout-confirmar');

    // toApiError (real en esta suite) usa el detail del problem+json, no un
    // mensaje inventado; la pantalla sigue siendo la de fallo.
    expect(texto(tree, 'checkout-fallo-mensaje')).toBe('La compra ya tiene un pago iniciado.');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(leerCarrito(tree).items).toHaveLength(1);

    desmontar(tree);
  });

  it('INT4-131: pago existente en Order se muestra sin simularlo ni crear otra compra', async () => {
    const tree = montar();

    await agregar(tree, linea(), 1);
    await llenarFormulario(tree);
    mockConsultarPago.mockResolvedValue({
      pagoId: 'pago-ya-existente',
      compraId: 'cmp-1',
      estado: 'aprobado',
    });

    await pulsar(tree, 'checkout-confirmar');

    expect(mockConsultarPago).toHaveBeenCalledWith('cmp-1');
    expect(mockSimularPago).not.toHaveBeenCalled();
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-ya-existente' },
    });
    expect(mockAbrirCheckout).not.toHaveBeenCalled();

    desmontar(tree);
  });

  it('INT4-131: parámetros de navegación fabricados no confirman ningún pago', async () => {
    mockParams.estado = 'realizada';
    mockParams.compraId = 'cmp-fabricada';
    mockParams.montoTotal = '999999';

    const tree = montar();

    // La vista es solo informativa: no se consulta ni se simula nada, no se
    // abre navegador de pago y no queda un botón que vuelva a cobrar.
    expect(mockCrearCompra).not.toHaveBeenCalled();
    expect(mockConsultarPago).not.toHaveBeenCalled();
    expect(mockSimularPago).not.toHaveBeenCalled();
    expect(mockAbrirCheckout).not.toHaveBeenCalled();
    expect(() => tree.root.findByProps({ testID: 'checkout-confirmar' })).toThrow();

    desmontar(tree);
  });
});

describe('Autocompletado del checkout con datos de la cuenta (A2 / INT4-127)', () => {
  it('precarga nombre completo, correo y teléfono desde GET /v1/auth/users/me', async () => {
    mockObtenerPerfil.mockResolvedValue(PERFIL);
    const tree = await montarConEspera();
    await agregar(tree, linea(), 1);

    expect(mockObtenerPerfil).toHaveBeenCalledTimes(1);
    expect(valorCampo(tree, 'checkout-nombre')).toBe(FORM_VALIDO.nombre);
    expect(valorCampo(tree, 'checkout-correo')).toBe(FORM_VALIDO.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(FORM_VALIDO.telefono);
    expect(() => tree.root.findByProps({ testID: 'checkout-perfil-error' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-usar-mis-datos' })).not.toThrow();

    desmontar(tree);
  });

  it('los campos precargados son editables y "Usar mis datos" restaura la precarga', async () => {
    mockObtenerPerfil.mockResolvedValue(PERFIL);
    const tree = await montarConEspera();
    await agregar(tree, linea(), 1);

    await escribir(tree, 'checkout-nombre', 'Otro Nombre');
    await escribir(tree, 'checkout-correo', 'otro@correo.cl');
    await escribir(tree, 'checkout-telefono', '999');

    expect(valorCampo(tree, 'checkout-nombre')).toBe('Otro Nombre');
    expect(valorCampo(tree, 'checkout-correo')).toBe('otro@correo.cl');
    expect(valorCampo(tree, 'checkout-telefono')).toBe('999');

    await pulsar(tree, 'checkout-usar-mis-datos');

    expect(valorCampo(tree, 'checkout-nombre')).toBe(FORM_VALIDO.nombre);
    expect(valorCampo(tree, 'checkout-correo')).toBe(FORM_VALIDO.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(FORM_VALIDO.telefono);

    desmontar(tree);
  });

  it('si la consulta falla, deja el formulario vacío y permite completar la compra', async () => {
    mockObtenerPerfil.mockRejectedValue(new Error('red caída'));
    const tree = await montarConEspera();
    await agregar(tree, linea(), 1);

    expect(texto(tree, 'checkout-perfil-error')).toBe(
      'No pudimos cargar tus datos. Podés completarlos igual.'
    );
    expect(valorCampo(tree, 'checkout-nombre')).toBe('');
    expect(valorCampo(tree, 'checkout-correo')).toBe('');
    expect(valorCampo(tree, 'checkout-telefono')).toBe('');
    expect(() => tree.root.findByProps({ testID: 'checkout-usar-mis-datos' })).toThrow();

    await llenarFormulario(tree);
    await pulsar(tree, 'checkout-confirmar');

    expect(mockCrearCompra).toHaveBeenCalledWith(
      [{ ofertaId: 'of-central-cafe', cantidad: 1 }],
      'token-de-prueba',
      {
        nombre: FORM_VALIDO.nombre,
        correo: FORM_VALIDO.correo,
        telefono: FORM_VALIDO.telefono,
        metodoEntrega: 'retiro',
      }
    );

    desmontar(tree);
  });

  it('muestra carga y no sobrescribe lo escrito mientras llega el perfil', async () => {
    let resolverPerfil!: (perfil: PerfilUsuario) => void;
    mockObtenerPerfil.mockImplementation(
      () =>
        new Promise<PerfilUsuario>((resolve) => {
          resolverPerfil = resolve;
        })
    );

    const tree = montar();
    await agregar(tree, linea(), 1);

    expect(() => tree.root.findByProps({ testID: 'checkout-perfil-cargando' })).not.toThrow();
    expect(tree.root.findByProps({ testID: 'checkout-nombre' }).props.editable).toBe(true);

    await escribir(tree, 'checkout-nombre', 'Nombre escrito a mano');

    await act(async () => {
      resolverPerfil(PERFIL);
    });

    expect(valorCampo(tree, 'checkout-nombre')).toBe('Nombre escrito a mano');
    expect(valorCampo(tree, 'checkout-correo')).toBe(FORM_VALIDO.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(FORM_VALIDO.telefono);
    expect(() => tree.root.findByProps({ testID: 'checkout-perfil-cargando' })).toThrow();

    desmontar(tree);
  });
});
