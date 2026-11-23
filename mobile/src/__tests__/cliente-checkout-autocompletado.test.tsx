// src/__tests__/cliente-checkout-autocompletado.test.tsx
//
// INT4-146: autocompletado del checkout. Estas pruebas van más allá del bloque
// básico de `cliente-checkout.test.tsx` (A2/INT4-127): comprueban el contrato
// completo del perfil como fuente de datos del formulario.
//
//   - precarga desde GET /v1/auth/users/me (nombre = nombre + apellido),
//   - campos editables y edición que NO se pierde,
//   - "Usar mis datos" restaura SIEMPRE la precarga original y limpia errores,
//   - un fallo del perfil no bloquea la compra: se escribe a mano y se paga,
//   - si el perfil llega tarde, solo completa los campos que quedaron vacíos.
//
// El provider del carrito se monta real para verificar que la compra efectiva
// (crearCompra + simularPago + navegación) ocurre también en el camino de error.
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import CheckoutScreen from '../app/(cliente)/checkout';
import { CarritoProvider, useCarrito } from '../context/CarritoContext';
import { obtenerPerfil } from '../services/auth';
import { ApiError } from '../services/httpClient';
import { consultarPago, crearCompra, simularPago } from '../services/pagos';
import { desmontar, escribir, limpiarRouter, pulsar, routerMock, texto } from '../test-utils';
import type { NuevoItemCarrito, Pago, PerfilUsuario } from '../types/domain';

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

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
  ESTADO_COMPRA_REVISION_REQUERIDA: 'revision_requerida',
}));

jest.mock('../services/auth', () => ({
  obtenerPerfil: jest.fn(),
}));

jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn(() => 'token-de-prueba') };
});

const mockCrearCompra = crearCompra as unknown as jest.Mock;
const mockConsultarPago = consultarPago as unknown as jest.Mock;
const mockSimularPago = simularPago as unknown as jest.Mock;
const mockObtenerPerfil = obtenerPerfil as unknown as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;
const mockGetItem = AsyncStorage.getItem as unknown as jest.Mock;

const PERFIL: PerfilUsuario = {
  id: 'user-1',
  email: 'maria@ca.cloudcoffee.cl',
  nombre: 'María Fernanda',
  apellido: 'López',
  telefono: '+56912345678',
  rol: 'CLIENTE',
};

// Tal como debe quedar el formulario después de la precarga.
const DATOS_PERFIL = {
  nombre: 'María Fernanda López',
  correo: PERFIL.email,
  telefono: PERFIL.telefono,
};

const PAGO_APROBADO: Pago = {
  pagoId: 'pago-1',
  compraId: 'cmp-1',
  estado: 'aprobado',
  motivo: 'aprobacion_simulada',
  montoTotal: 1800,
  moneda: 'CLP',
  simulado: true,
  proveedor: 'simulado',
  creadoAt: '2026-01-01T00:00:00Z',
  actualizadoAt: '2026-01-01T00:00:00Z',
  version: 1,
};

function linea(): NuevoItemCarrito {
  return {
    ofertaId: 'of-central-cafe',
    productoId: 'prod-cafe',
    productoNombre: 'Café Americano 12oz',
    precioUnitario: 1800,
    cafeteriaId: 'cafe-central',
    cafeteriaNombre: 'Cafetería Central',
    stock: 5,
  };
}

type ValorCarrito = ReturnType<typeof useCarrito>;

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

async function montarAsentado(): Promise<ReactTestRenderer> {
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

async function agregarProducto(tree: ReactTestRenderer): Promise<void> {
  await act(async () => {
    leerCarrito(tree).agregar(linea(), 1);
  });
}

async function completar(
  tree: ReactTestRenderer,
  datos: { nombre: string; correo: string; telefono: string }
): Promise<void> {
  await escribir(tree, 'checkout-nombre', datos.nombre);
  await escribir(tree, 'checkout-correo', datos.correo);
  await escribir(tree, 'checkout-telefono', datos.telefono);
}

function payloadEsperado(datos = DATOS_PERFIL) {
  return [
    [{ ofertaId: 'of-central-cafe', cantidad: 1 }],
    'token-de-prueba',
    { ...datos, metodoEntrega: 'retiro' },
  ];
}

beforeEach(() => {
  limpiarRouter();
  mockUseLocalSearchParams.mockReturnValue({});
  mockObtenerPerfil.mockReset();
  // Los tests que no necesitan perfil lo dejan pendiente: así no hay estados
  // fuera de `act` y el formulario arranca vacío.
  mockObtenerPerfil.mockImplementation(() => new Promise(() => {}));

  mockCrearCompra.mockReset();
  mockCrearCompra.mockResolvedValue({
    compraId: 'cmp-1',
    estado: 'pendiente_pago',
    montoTotal: 1800,
  });
  mockConsultarPago.mockReset();
  mockConsultarPago.mockRejectedValue(new ApiError('PAGO_NO_ENCONTRADO', 404));
  mockSimularPago.mockReset();
  mockSimularPago.mockResolvedValue(PAGO_APROBADO);
  mockGetItem.mockReset();
  mockGetItem.mockResolvedValue(null);
});

describe('INT4-146: precarga del checkout desde el perfil', () => {
  it('precarga nombre completo, correo y teléfono con una sola consulta al perfil', async () => {
    mockObtenerPerfil.mockResolvedValue(PERFIL);
    const tree = await montarAsentado();
    await agregarProducto(tree);

    expect(mockObtenerPerfil).toHaveBeenCalledTimes(1);
    expect(valorCampo(tree, 'checkout-nombre')).toBe(DATOS_PERFIL.nombre);
    expect(valorCampo(tree, 'checkout-correo')).toBe(DATOS_PERFIL.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(DATOS_PERFIL.telefono);
    expect(() => tree.root.findByProps({ testID: 'checkout-perfil-cargando' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-perfil-error' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-usar-mis-datos' })).not.toThrow();
    expect(tree.root.findByProps({ testID: 'checkout-nombre' }).props.editable).toBe(true);

    desmontar(tree);
  });

  it('compone el nombre sin espacios sobrantes cuando falta el apellido o el teléfono', async () => {
    mockObtenerPerfil.mockResolvedValue({
      ...PERFIL,
      nombre: 'Ana',
      apellido: '',
      telefono: '',
    });
    const tree = await montarAsentado();
    await agregarProducto(tree);

    expect(valorCampo(tree, 'checkout-nombre')).toBe('Ana');
    expect(valorCampo(tree, 'checkout-telefono')).toBe('');

    desmontar(tree);
  });
});

describe('INT4-146: edición y botón "Usar mis datos"', () => {
  it('los campos precargados se pueden editar y conservan lo escrito', async () => {
    mockObtenerPerfil.mockResolvedValue(PERFIL);
    const tree = await montarAsentado();
    await agregarProducto(tree);

    const editado = {
      nombre: 'Otro Nombre',
      correo: 'otro@correo.cl',
      telefono: '999',
    };
    await completar(tree, editado);

    expect(valorCampo(tree, 'checkout-nombre')).toBe(editado.nombre);
    expect(valorCampo(tree, 'checkout-correo')).toBe(editado.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(editado.telefono);
    expect(mockObtenerPerfil).toHaveBeenCalledTimes(1);

    desmontar(tree);
  });

  it('"Usar mis datos" restaura la precarga original y limpia los errores de validación', async () => {
    mockObtenerPerfil.mockResolvedValue(PERFIL);
    const tree = await montarAsentado();
    await agregarProducto(tree);

    // Se borra todo y se intenta confirmar: deben aparecer los tres errores y
    // NO debe llamarse al backend.
    await completar(tree, { nombre: '', correo: '', telefono: '' });
    await pulsar(tree, 'checkout-confirmar');
    expect(() => tree.root.findByProps({ testID: 'checkout-error-nombre' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-error-correo' })).not.toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-error-telefono' })).not.toThrow();
    expect(mockCrearCompra).not.toHaveBeenCalled();

    await pulsar(tree, 'checkout-usar-mis-datos');

    expect(valorCampo(tree, 'checkout-nombre')).toBe(DATOS_PERFIL.nombre);
    expect(valorCampo(tree, 'checkout-correo')).toBe(DATOS_PERFIL.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(DATOS_PERFIL.telefono);
    expect(() => tree.root.findByProps({ testID: 'checkout-error-nombre' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-error-correo' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-error-telefono' })).toThrow();
    expect(mockObtenerPerfil).toHaveBeenCalledTimes(1);

    // Con los datos restaurados la compra sí se completa.
    await pulsar(tree, 'checkout-confirmar');
    expect(mockCrearCompra).toHaveBeenCalledWith(...payloadEsperado());

    desmontar(tree);
  });

  it('"Usar mis datos" vuelve siempre a la precarga, nunca a la última edición', async () => {
    mockObtenerPerfil.mockResolvedValue(PERFIL);
    const tree = await montarAsentado();
    await agregarProducto(tree);

    await completar(tree, { nombre: 'Primera edición', correo: 'a@a.cl', telefono: '111' });
    await pulsar(tree, 'checkout-usar-mis-datos');
    expect(valorCampo(tree, 'checkout-nombre')).toBe(DATOS_PERFIL.nombre);

    await completar(tree, { nombre: 'Segunda edición', correo: 'b@b.cl', telefono: '222' });
    expect(valorCampo(tree, 'checkout-nombre')).toBe('Segunda edición');
    await pulsar(tree, 'checkout-usar-mis-datos');

    expect(valorCampo(tree, 'checkout-nombre')).toBe(DATOS_PERFIL.nombre);
    expect(valorCampo(tree, 'checkout-correo')).toBe(DATOS_PERFIL.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(DATOS_PERFIL.telefono);
    expect(mockObtenerPerfil).toHaveBeenCalledTimes(1);

    desmontar(tree);
  });
});

describe('INT4-146: fallo o demora del perfil', () => {
  it('si GET /users/me falla, avisa y permite completar la compra con datos escritos a mano', async () => {
    mockObtenerPerfil.mockRejectedValue(new ApiError('Perfil no disponible', 500));
    const tree = await montarAsentado();
    await agregarProducto(tree);

    expect(texto(tree, 'checkout-perfil-error')).toBe(
      'No pudimos cargar tus datos. Podés completarlos igual.'
    );
    expect(valorCampo(tree, 'checkout-nombre')).toBe('');
    expect(valorCampo(tree, 'checkout-correo')).toBe('');
    expect(valorCampo(tree, 'checkout-telefono')).toBe('');
    expect(() => tree.root.findByProps({ testID: 'checkout-usar-mis-datos' })).toThrow();

    await completar(tree, DATOS_PERFIL);
    await pulsar(tree, 'checkout-confirmar');

    expect(mockCrearCompra).toHaveBeenCalledWith(...payloadEsperado());
    expect(mockSimularPago).toHaveBeenCalledWith('cmp-1', expect.any(String), expect.any(String));
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/resultado-pago',
      params: { compraId: 'cmp-1', pagoId: 'pago-1' },
    });
    expect(leerCarrito(tree).items).toEqual([]);

    desmontar(tree);
  });

  it('si el perfil llega tarde, llena solo los campos vacíos y "Usar mis datos" recupera la precarga', async () => {
    let resolverPerfil!: (perfil: PerfilUsuario) => void;
    mockObtenerPerfil.mockImplementation(
      () =>
        new Promise<PerfilUsuario>((resolve) => {
          resolverPerfil = resolve;
        })
    );

    const tree = montar();
    await agregarProducto(tree);

    expect(() => tree.root.findByProps({ testID: 'checkout-perfil-cargando' })).not.toThrow();
    expect(tree.root.findByProps({ testID: 'checkout-nombre' }).props.editable).toBe(true);
    await escribir(tree, 'checkout-nombre', 'Nombre escrito a mano');

    await act(async () => {
      resolverPerfil(PERFIL);
    });

    expect(valorCampo(tree, 'checkout-nombre')).toBe('Nombre escrito a mano');
    expect(valorCampo(tree, 'checkout-correo')).toBe(DATOS_PERFIL.correo);
    expect(valorCampo(tree, 'checkout-telefono')).toBe(DATOS_PERFIL.telefono);
    expect(() => tree.root.findByProps({ testID: 'checkout-perfil-cargando' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'checkout-usar-mis-datos' })).not.toThrow();

    await pulsar(tree, 'checkout-usar-mis-datos');
    expect(valorCampo(tree, 'checkout-nombre')).toBe(DATOS_PERFIL.nombre);

    await pulsar(tree, 'checkout-confirmar');
    expect(mockCrearCompra).toHaveBeenCalledWith(...payloadEsperado());

    desmontar(tree);
  });
});
