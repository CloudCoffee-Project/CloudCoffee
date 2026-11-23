// src/__tests__/cliente-recorrido-compra.test.tsx
//
// INT4-129: prueba del recorrido de compra COMPLETO, de principio a fin y sin
// pantallas huérfanas. La navegación se simula con el router falso compartido:
// el checkout entrega compraId/pagoId en /resultado-pago, esa pantalla consulta
// el estado REAL del pago y decide el destino, y acá se monta ese destino con
// los parámetros que viajaron para comprobar que efectivamente existe y carga.
//
//   aprobado  → /(cliente)/qr-retiro (QR que habilita Order)
//   pendiente → /(cliente)/seguimientos (orden en vivo)
//   rechazado → se queda en resultado-pago; el botón vuelve a /carrito (sin vaciar)
//
// Además cubre el ingreso a la orden en vivo desde Mis compras ("En vivo"),
// que es la otra puerta al seguimiento cuando la compra ya está en el historial.
import type { ReactElement } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import CheckoutScreen from '../app/(cliente)/checkout';
import MisComprasScreen from '../app/(cliente)/mis-compras';
import QrRetiroScreen from '../app/(cliente)/qr-retiro';
import ResultadoPagoScreen from '../app/(cliente)/resultado-pago';
import SeguimientosScreen from '../app/(cliente)/seguimientos';
import { ESCENARIO_PAGO_CLIENTE } from '../config/pagoSimulado';
import { CarritoProvider, useCarrito } from '../context/CarritoContext';
import { useOrdenEstado } from '../hooks/useOrdenEstado';
import { obtenerPerfil } from '../services/auth';
import { listarCompras, obtenerCompra } from '../services/compras';
import { ApiError, getAccessToken } from '../services/httpClient';
import { obtenerOrden, obtenerQrRetiro } from '../services/ordenes';
import { consultarPago, crearCompra, simularPago } from '../services/pagos';
import {
  desmontar,
  escribir,
  limpiarRouter,
  pulsar,
  routerMock,
  texto,
  textoDe,
} from '../test-utils';
import type {
  Compra,
  EstadoOrden,
  EstadoPago,
  MotivoPago,
  NuevoItemCarrito,
  Orden,
  Pago,
  QrRetiroBackend,
} from '../types/domain';

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);

jest.mock('react-native-qrcode-svg', () => 'QRCode');

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

// El provider del carrito se monta real: INTERESA saber si el pago aprobado lo
// vació y si rechazado/pendiente lo conservaron para reintentar. AuthContext se
// mockea solo porque el provider necesita saber quién tiene la sesión abierta.
jest.mock('../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    sesion: { userId: 'user-1', rol: 'cliente', cafeteriaId: null, exp: 0 },
    bootstrapping: false,
    iniciarSesion: jest.fn(),
    cerrarSesion: jest.fn(),
  })),
}));

jest.mock('../services/pagos', () => ({
  crearCompra: jest.fn(),
  consultarPago: jest.fn(),
  simularPago: jest.fn(),
  abrirCheckoutMercadoPago: jest.fn(),
  parsearRetornoPago: jest.fn(),
  generarIdempotencyKey: jest.requireActual('../services/pagos').generarIdempotencyKey,
  // Valor real del contrato (NO 'revisión requerida', que era de un mock viejo).
  ESTADO_COMPRA_REVISION_REQUERIDA: 'revision_requerida',
}));

jest.mock('../services/compras', () => ({
  obtenerCompra: jest.fn(),
  listarCompras: jest.fn(),
  confirmarCompra: jest.fn(),
  cancelarCompra: jest.fn(),
}));

jest.mock('../services/ordenes', () => ({
  obtenerOrden: jest.fn(),
  obtenerQrRetiro: jest.fn(),
  confirmarOrden: jest.fn(),
  cancelarOrden: jest.fn(),
}));

jest.mock('../services/auth', () => ({
  obtenerPerfil: jest.fn(),
}));

jest.mock('../hooks/useOrdenEstado', () => ({
  useOrdenEstado: jest.fn(() => null),
}));

// Se reemplaza solo el token: toApiError y ApiProblem siguen reales.
jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn(() => 'token-de-prueba') };
});

const mockCrearCompra = crearCompra as unknown as jest.Mock;
const mockConsultarPago = consultarPago as unknown as jest.Mock;
const mockSimularPago = simularPago as unknown as jest.Mock;
const mockObtenerCompra = obtenerCompra as unknown as jest.Mock;
const mockListarCompras = listarCompras as unknown as jest.Mock;
const mockObtenerOrden = obtenerOrden as unknown as jest.Mock;
const mockObtenerQrRetiro = obtenerQrRetiro as unknown as jest.Mock;
const mockObtenerPerfil = obtenerPerfil as unknown as jest.Mock;
const mockGetAccessToken = getAccessToken as unknown as jest.Mock;
const mockUseOrdenEstado = useOrdenEstado as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;
const mockGetItem = AsyncStorage.getItem as unknown as jest.Mock;
const mockSetItem = AsyncStorage.setItem as unknown as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as unknown as jest.Mock;

const COMPRA_ID = 'cmp-1';
const FORMA_PAGO = {
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

function pago(estado: EstadoPago, pagoId: string): Pago {
  const motivo: MotivoPago =
    estado === 'aprobado'
      ? 'aprobacion_simulada'
      : estado === 'rechazado'
        ? 'rechazo_simulado'
        : estado === 'requiere_conciliacion'
          ? 'conciliacion_requerida'
          : 'escenario_pendiente';

  return {
    pagoId,
    compraId: COMPRA_ID,
    estado,
    motivo,
    montoTotal: 1800,
    moneda: 'CLP',
    simulado: true,
    proveedor: 'simulado',
    creadoAt: '2026-01-01T00:00:00Z',
    actualizadoAt: '2026-01-01T00:00:00Z',
    version: 1,
  };
}

function orden(estado: EstadoOrden = 'pendiente_pago'): Orden {
  return {
    ordenId: 'orden-1',
    codigoOrden: 'ORD-1',
    cafeteriaId: 'caf-1',
    cafeteriaNombre: 'Cafetería Central',
    estado,
    montoTotal: 1800,
    items: [],
  };
}

function compra(estadoPago: EstadoPago, pagoId: string, estadoOrden: EstadoOrden): Compra {
  return {
    compraId: COMPRA_ID,
    montoTotal: 1800,
    estado: estadoPago === 'aprobado' ? 'pagado' : 'pendiente_pago',
    ordenes: [orden(estadoOrden)],
    pago: pago(estadoPago, pagoId),
  };
}

const QR: QrRetiroBackend = {
  ordenId: 'orden-1',
  codigo: 'A'.repeat(43),
  expiraAt: '2026-01-01T01:00:00Z',
};

type ValorCarrito = ReturnType<typeof useCarrito>;

function Sonda() {
  const valor = useCarrito();
  return <View testID="carrito-sonda" {...valor} />;
}

function leerCarrito(tree: ReactTestRenderer): ValorCarrito {
  return tree.root.findAllByProps({ testID: 'carrito-sonda' })[0].props as ValorCarrito;
}

function montarCheckout(): ReactTestRenderer {
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

async function agregar(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    leerCarrito(tree).agregar(linea(), 1);
  });
}

async function llenarFormulario(tree: ReactTestRenderer): Promise<void> {
  await escribir(tree, 'checkout-nombre', FORMA_PAGO.nombre);
  await escribir(tree, 'checkout-correo', FORMA_PAGO.correo);
  await escribir(tree, 'checkout-telefono', FORMA_PAGO.telefono);
}

// Ejecuta el callback que el mock de useFocusEffect capturó. Es equivalente a
// que la pantalla ganara foco (donde estas vistas consultan el backend).
async function enfocar(): Promise<void> {
  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });
}

async function renderizarConFoco(elemento: ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(elemento);
  });
  await enfocar();
  return tree;
}

interface ParamsResultado {
  compraId: string;
  pagoId: string;
}

async function confirmarEnCheckout(
  estado: EstadoPago,
  pagoId: string
): Promise<{ tree: ReactTestRenderer; params: ParamsResultado }> {
  mockSimularPago.mockResolvedValue(pago(estado, pagoId));

  const tree = montarCheckout();
  await agregar(tree);
  await llenarFormulario(tree);
  await pulsar(tree, 'checkout-confirmar');

  const destino = routerMock.replace.mock.calls[0]?.[0] as
    { pathname: string; params: ParamsResultado } | undefined;
  if (destino?.pathname !== '/resultado-pago') {
    throw new Error('El checkout no entregó el recorrido a /resultado-pago');
  }
  expect(destino.params).toEqual({ compraId: COMPRA_ID, pagoId });

  return { tree, params: destino.params };
}

function configurarConsulta(estado: EstadoPago, pagoId: string, estadoOrden: EstadoOrden): void {
  mockConsultarPago.mockResolvedValue(pago(estado, pagoId));
  mockObtenerCompra.mockResolvedValue(compra(estado, pagoId, estadoOrden));
}

async function renderizarResultado(params: ParamsResultado): Promise<ReactTestRenderer> {
  limpiarRouter();
  mockUseLocalSearchParams.mockReturnValue(params);
  return renderizarConFoco(<ResultadoPagoScreen />);
}

async function renderizarQr(params: Record<string, string>): Promise<ReactTestRenderer> {
  mockUseLocalSearchParams.mockReturnValue(params);
  return renderizarConFoco(<QrRetiroScreen />);
}

async function renderizarSeguimiento(params: Record<string, string>): Promise<ReactTestRenderer> {
  mockUseLocalSearchParams.mockReturnValue(params);
  return renderizarConFoco(<SeguimientosScreen />);
}

async function renderizarMisCompras(): Promise<ReactTestRenderer> {
  return renderizarConFoco(<MisComprasScreen />);
}

beforeEach(() => {
  limpiarRouter();
  mockUseFocusEffect.mockReset();
  mockUseLocalSearchParams.mockReset();
  mockUseLocalSearchParams.mockReturnValue({});
  mockUseOrdenEstado.mockReset();
  mockUseOrdenEstado.mockReturnValue(null);

  mockCrearCompra.mockReset();
  mockCrearCompra.mockResolvedValue({
    compraId: COMPRA_ID,
    estado: 'pendiente_pago',
    montoTotal: 1800,
  });
  mockConsultarPago.mockReset();
  mockConsultarPago.mockRejectedValue(new ApiError('PAGO_NO_ENCONTRADO', 404));
  mockSimularPago.mockReset();

  mockObtenerCompra.mockReset();
  mockListarCompras.mockReset();
  mockObtenerOrden.mockReset();
  mockObtenerOrden.mockResolvedValue(orden('pendiente_pago'));
  mockObtenerQrRetiro.mockReset();
  mockObtenerQrRetiro.mockResolvedValue(QR);

  mockObtenerPerfil.mockReset();
  // Perfil pendiente: los datos del formulario son los que escribe el usuario.
  mockObtenerPerfil.mockImplementation(() => new Promise(() => {}));
  mockGetAccessToken.mockReset();
  mockGetAccessToken.mockReturnValue('token-de-prueba');

  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockRemoveItem.mockReset();
  mockGetItem.mockResolvedValue(null);
});

describe('INT4-129: recorrido de compra sin pantallas huérfanas', () => {
  it('aprobado: checkout → resultado → QR de retiro, con el carrito vaciado', async () => {
    const { tree: checkout, params } = await confirmarEnCheckout('aprobado', 'pago-aprobado');
    expect(leerCarrito(checkout).items).toEqual([]);
    expect(mockSimularPago).toHaveBeenCalledWith(
      COMPRA_ID,
      ESCENARIO_PAGO_CLIENTE,
      expect.any(String)
    );

    configurarConsulta('aprobado', 'pago-aprobado', 'listo_para_retiro');
    const resultado = await renderizarResultado(params);

    expect(mockConsultarPago).toHaveBeenCalledWith(COMPRA_ID);
    expect(routerMock.replace).toHaveBeenLastCalledWith({
      pathname: '/(cliente)/qr-retiro',
      params: { compraId: COMPRA_ID },
    });
    desmontar(resultado);

    // El destino existe y, con el compraId que viajó, muestra el QR de Order.
    const destino = await renderizarQr({ compraId: COMPRA_ID });
    expect(mockObtenerCompra).toHaveBeenLastCalledWith(COMPRA_ID);
    expect(mockObtenerQrRetiro).toHaveBeenCalledWith('orden-1');
    expect(texto(destino, 'qr-retiro-codigo-texto')).toContain(QR.codigo);
    desmontar(destino);
    desmontar(checkout);
  });

  it('pendiente: checkout → resultado → orden en vivo, con el carrito intacto', async () => {
    const { tree: checkout, params } = await confirmarEnCheckout('pendiente', 'pago-pendiente');
    expect(leerCarrito(checkout).items).toHaveLength(1);

    configurarConsulta('pendiente', 'pago-pendiente', 'pendiente_pago');
    const resultado = await renderizarResultado(params);

    expect(routerMock.replace).toHaveBeenLastCalledWith({
      pathname: '/(cliente)/seguimientos',
      params: { compraId: COMPRA_ID, ordenId: 'orden-1' },
    });
    desmontar(resultado);

    // Los parámetros de la navegación cargan de verdad la pantalla de seguimiento.
    const destino = await renderizarSeguimiento({
      compraId: COMPRA_ID,
      ordenId: 'orden-1',
    });
    expect(mockObtenerOrden).toHaveBeenCalledWith('orden-1');
    expect(texto(destino, 'seguimiento-orden')).toBe('#ORD-1');
    expect(() => destino.root.findByProps({ testID: 'seguimiento-sin-qr' })).not.toThrow();
    desmontar(destino);
    desmontar(checkout);
  });

  it('rechazado: resultado no navega solo y el botón vuelve al carrito sin vaciarlo', async () => {
    const { tree: checkout, params } = await confirmarEnCheckout('rechazado', 'pago-rechazado');
    expect(leerCarrito(checkout).items).toHaveLength(1);

    configurarConsulta('rechazado', 'pago-rechazado', 'pendiente_pago');
    const resultado = await renderizarResultado(params);

    expect(texto(resultado, 'resultado-titulo')).toBe('Pago rechazado');
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(() => resultado.root.findByProps({ testID: 'resultado-ir-qr' })).toThrow();

    await pulsar(resultado, 'resultado-ir-carrito');
    expect(routerMock.replace).toHaveBeenCalledWith('/carrito');
    expect(leerCarrito(checkout).items).toHaveLength(1);

    desmontar(resultado);
    desmontar(checkout);
  });
});

describe('INT4-129: orden en vivo desde Mis compras', () => {
  it('abre el seguimiento con los ids de la compra y de la orden, y la pantalla carga', async () => {
    mockListarCompras.mockResolvedValue([
      {
        compraId: COMPRA_ID,
        montoTotal: 1800,
        estado: 'pagado',
        ordenes: [orden('pagado')],
      },
    ]);
    mockObtenerOrden.mockResolvedValue(orden('pagado'));

    const historial = await renderizarMisCompras();
    const boton = historial.root.findByProps({ testID: 'seguir-orden-orden-1' });
    expect(textoDe(boton)).toContain('En vivo');

    await pulsar(historial, 'seguir-orden-orden-1');

    const destinoEsperado = {
      pathname: '/(cliente)/seguimientos',
      params: { compraId: COMPRA_ID, ordenId: 'orden-1' },
    };
    expect(routerMock.push).toHaveBeenCalledWith(destinoEsperado);
    desmontar(historial);

    // Mismo contrato que usa resultado-pago: no hay un segundo seguimiento
    // "de historial" que pueda quedar huérfano.
    limpiarRouter();
    const seguimiento = await renderizarSeguimiento(destinoEsperado.params);
    expect(mockObtenerOrden).toHaveBeenCalledWith('orden-1');
    expect(texto(seguimiento, 'seguimiento-orden')).toBe('#ORD-1');
    expect(texto(seguimiento, 'seguimiento-estado')).toContain('Pagado');
    desmontar(seguimiento);
  });
});
