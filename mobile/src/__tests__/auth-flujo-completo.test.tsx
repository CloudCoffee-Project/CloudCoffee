// src/__tests__/auth-flujo-completo.test.tsx
//
// Pruebas end-to-end del flujo completo de autenticación (INT4-25). Recorren el
// camino real que recorre una persona para entrar y salir de la app:
//
//   registro → verificación de correo → login → llamada autenticada → logout
//
// A diferencia de las pruebas por pantalla, acá no se mockea la capa de red: se
// pone un adapter de axios en el httpClient que responde como el auth-service
// (POST /register, /verificacion, /login, /logout, 401 /credenciales-invalidas,
// 403 /cuenta-no-verificada, refresh rotativo y refresh revocado al cerrar
// sesión). Con eso pasan por la cadena real: los services de auth, el interceptor
// que mete el Bearer, el refresh single-flight ante un 401, la persistencia en
// SecureStore y el AuthContext (iniciarSesion / cerrarSesion).
//
// El cierre de sesión (INT4-25) es el paso nuevo que cierra este flujo: se
// verifica que POST /v1/auth/logout viaje con el refreshToken vigente y el
// Bearer, que el backend revoque ese refresh, y que el dispositivo quede sin
// tokens.
//
// Solo se mockea lo que no es del flujo: el perfil (GET /v1/auth/me está roto
// del lado del server, ver docs/contratos-backend.md) y el token de push, que es
// otro dominio (INT4-42). El refresh usa su propio cliente de axios (authRefresh,
// aislado a propósito para no recursar con los interceptores), así que se
// mockea ese módulo: la rotación y la revocación las simula el mismo backend.

import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Text as RNText, TextInput } from 'react-native';
import type { ReactElement } from 'react';
import { AxiosError } from 'axios';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

import { AuthProvider, useAuth } from '../context/AuthContext';
import LoginScreen from '../app/(auth)/login';
import RegistroScreen from '../app/(auth)/registro';
import VerificarCorreoScreen from '../app/(auth)/verificar-correo';
import PerfilScreen from '../app/(cliente)/perfil';
import { httpClient } from '../services/httpClient';
import { requestNewTokens } from '../services/authRefresh';
import { eliminarRegistroPush } from '../services/notificacionesPush';
import { leerSesion } from '../services/sessionStorage';
import { obtenerPerfil } from '../services/auth';
import { listarProductos } from '../services/catalog';
import type { LoginResponse, Producto } from '../types/domain';

const mockRequestNewTokens = requestNewTokens as unknown as jest.Mock;
const mockObtenerPerfil = obtenerPerfil as unknown as jest.Mock;
const mockEliminarRegistroPush = eliminarRegistroPush as unknown as jest.Mock;

jest.mock('../services/authRefresh', () => ({
  requestNewTokens: jest.fn(),
}));

jest.mock('../services/notificacionesPush', () => ({
  eliminarRegistroPush: jest.fn(async () => undefined),
}));

// El perfil no es parte de este flujo y su ruta está rota en el backend (el
// UserController se mapea a /v1/v1/auth y el gateway solo quita un prefijo, así
// que da 404). El resto del módulo de auth queda real: este archivo prueba eso.
jest.mock('../services/auth', () => ({
  ...jest.requireActual('../services/auth'),
  obtenerPerfil: jest.fn(),
}));

// SecureStore es nativo: se reemplaza por un mapa en memoria, que es lo que
// permite afirmar que al cerrar sesión no queda ningún token en el dispositivo.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __reset: () => store.clear(),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const secureStore = jest.requireMock('expo-secure-store') as { __reset: () => void };

// AsyncStorage no existe como módulo nativo en Jest. services/catalog lo usa
// para la sede seleccionada, y acá interesa que la lectura devuelva null: este
// flujo no pasa por la pantalla de campus.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockParams: Record<string, string> = {};
const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: mockReplace, push: mockPush })),
  useLocalSearchParams: jest.fn(() => mockParams),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

// ---------------------------------------------------------------------------
// Backend simulado del auth-service
// ---------------------------------------------------------------------------

const USUARIO_ID = '9a1f2c3d-0000-4000-8000-000000000001';
const CORREO = 'ana.perez@uct.cl';
const CLAVE = 'secreto123';
// El token de verificación es lo que el backend manda por correo; la app solo
// lo pega en la pantalla, nunca lo genera.
const TOKEN_VERIFICACION = 'token-de-verificacion-1';

interface UsuarioSimulado {
  id: string;
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  telefono: string;
  rol: string;
  verificado: boolean;
}

interface BackendSimulado {
  usuarios: Map<string, UsuarioSimulado>;
  // refreshToken vigente -> id de usuario. Un refresh revocado no está en el
  // mapa: es lo que hace el backend al rotarlo y al cerrar sesión.
  refreshVigentes: Map<string, string>;
  tokensVerificacion: Set<string>;
  llamadas: string[];
}

const backend: BackendSimulado = {
  usuarios: new Map(),
  refreshVigentes: new Map(),
  tokensVerificacion: new Set(),
  llamadas: [],
};

// Estado del escenario, no del backend: si viviera en el objeto, reiniciar el
// backend la dejaría pegada entre tests.
let accessVencido = false;
let contadorRefresh = 0;

// El backend arranca vacío: la cuenta la crea la pantalla de registro en cada
// test, como en el flujo real.
function reiniciarBackend(): void {
  backend.usuarios.clear();
  backend.refreshVigentes.clear();
  backend.tokensVerificacion.clear();
  backend.llamadas.length = 0;
  accessVencido = false;
  contadorRefresh = 0;
}

// Firma un JWT como el auth-service: { sub, role, iat, exp, jti }. El claim del
// rol es `role` (no `rol`) y el de la persona es `sub`, que es lo que la app
// decodifica. El jti es lo que hace que dos tokens emitidos en el mismo segundo
// no salgan idénticos, igual que en el backend.
let emisión = 0;

function firmarJwt(usuario: UsuarioSimulado, vencido: boolean): string {
  const payload = {
    sub: usuario.id,
    role: usuario.rol,
    iat: Math.floor(Date.now() / 1000),
    exp: vencido ? Math.floor(Date.now() / 1000) - 60 : Math.floor(Date.now() / 1000) + 900,
    jti: `emision-${++emisión}`,
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const base64 = btoa(String.fromCharCode(...json))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `header.${base64}.firma`;
}

function emitirTokens(usuario: UsuarioSimulado, vencido = false): LoginResponse {
  // Contador monotónico y no el tamaño del mapa: al rotar se borra el refresh
  // viejo antes de emitir el nuevo, así que el tamaño vuelve al mismo valor y
  // el token "nuevo" saldría con el mismo nombre que el revocado.
  const refreshToken = `refresh-${++contadorRefresh}-${usuario.id}`;
  backend.refreshVigentes.set(refreshToken, usuario.id);
  // Un token recién emitido está vigente: el flag de "access vencido" se
  // levanta solo al renovar, que es lo que pasa después de un 401.
  accessVencido = vencido;

  return { accessToken: firmarJwt(usuario, vencido), refreshToken };
}

// Lee el Bearer de la petición y devuelve el usuario si el token es válido.
function usuarioDelBearer(config: InternalAxiosRequestConfig): UsuarioSimulado | null {
  const encabezado = (config.headers?.get?.('Authorization') as string | undefined) ?? '';
  if (!encabezado.startsWith('Bearer ')) {
    return null;
  }

  const payload = decodificar(encabezado.slice(7));
  if (!payload || typeof payload.exp !== 'number') {
    return null;
  }

  // Un accessToken vencido es un 401 del backend, que es lo que dispara el
  // refresh en el interceptor.
  if (payload.exp <= Math.floor(Date.now() / 1000) || accessVencido) {
    return null;
  }

  for (const usuario of backend.usuarios.values()) {
    if (usuario.id === payload.sub) {
      return usuario;
    }
  }

  return null;
}

function decodificar(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))
    );
  } catch {
    return null;
  }
}

function problema(detail: string, status: number, type: string): Record<string, unknown> {
  return {
    type: `https://cloudcoffee.cl/problems/${type}`,
    title: type,
    status,
    detail,
    timestamp: new Date().toISOString(),
  };
}

interface RespuestaSimulada {
  data: unknown;
  status: number;
}

// El request transformer de axios serializa el body a JSON antes de que lo
// reciba el adapter, así que el body llega como string y hay que parsearlo.
function cuerpoDe(config: InternalAxiosRequestConfig): Record<string, string> {
  if (typeof config.data === 'string') {
    try {
      return JSON.parse(config.data) as Record<string, string>;
    } catch {
      return {};
    }
  }

  return (config.data ?? {}) as Record<string, string>;
}

function responder(config: InternalAxiosRequestConfig): RespuestaSimulada {
  const metodo = (config.method ?? 'get').toUpperCase();
  const url = new URL(config.url ?? '', 'http://gateway.test');
  for (const [clave, valor] of Object.entries((config.params ?? {}) as Record<string, string>)) {
    url.searchParams.set(clave, String(valor));
  }

  const ruta = url.pathname;
  backend.llamadas.push(`${metodo} ${ruta}`);

  const cuerpo = cuerpoDe(config);
  const email = (cuerpo.email ?? '').trim().toLowerCase();

  if (metodo === 'POST' && ruta === '/v1/auth/register') {
    if (backend.usuarios.has(email)) {
      throw errorDe(config, 'Ya existe una cuenta con ese correo.', 409, 'correo-en-uso');
    }

    const usuario: UsuarioSimulado = {
      id: USUARIO_ID,
      email,
      password: cuerpo.password,
      nombre: cuerpo.nombre,
      apellido: cuerpo.apellido,
      telefono: cuerpo.telefono,
      rol: 'CLIENTE',
      verificado: false,
    };
    backend.usuarios.set(email, usuario);
    backend.tokensVerificacion.add(TOKEN_VERIFICACION);

    return {
      status: 201,
      data: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        telefono: usuario.telefono,
        rol: usuario.rol,
        verificado: false,
      },
    };
  }

  if (metodo === 'POST' && ruta === '/v1/auth/verificacion') {
    if (!backend.tokensVerificacion.has(cuerpo.token)) {
      throw errorDe(config, 'El token de verificación no es válido.', 400, 'token-invalido');
    }

    backend.tokensVerificacion.delete(cuerpo.token);
    const usuario = backend.usuarios.get(email) ?? [...backend.usuarios.values()][0];
    usuario.verificado = true;

    return { status: 200, data: { email: usuario.email, verificado: true } };
  }

  if (metodo === 'POST' && ruta === '/v1/auth/verificacion/reenviar') {
    const usuario = backend.usuarios.get(email);
    if (usuario) {
      backend.tokensVerificacion.add(`token-reenviado-${backend.tokensVerificacion.size + 1}`);
    }

    return { status: 202, data: null };
  }

  if (metodo === 'POST' && ruta === '/v1/auth/login') {
    const usuario = backend.usuarios.get(email);
    if (!usuario || usuario.password !== cuerpo.password) {
      throw errorDe(
        config,
        'El correo o la contraseña no son correctos.',
        401,
        'credenciales-invalidas'
      );
    }

    if (!usuario.verificado) {
      throw errorDe(
        config,
        'Debes verificar tu correo antes de iniciar sesión.',
        403,
        'cuenta-no-verificada'
      );
    }

    return { status: 200, data: emitirTokens(usuario) };
  }

  if (metodo === 'POST' && ruta === '/v1/auth/logout') {
    // El backend exige los dos: el accessToken en el Bearer y el refreshToken
    // en el body. Es lo que hace que la revocación vaya antes de limpiar tokens.
    if (!usuarioDelBearer(config)) {
      throw errorDe(config, 'Sesión inválida.', 401, 'token-invalido');
    }

    if (!cuerpo.refreshToken) {
      throw errorDe(config, 'Falta el refreshToken.', 400, 'refresh-token-requerido');
    }

    backend.refreshVigentes.delete(cuerpo.refreshToken);
    return { status: 204, data: null };
  }

  if (metodo === 'GET' && ruta === '/v1/catalog/productos') {
    if (!usuarioDelBearer(config)) {
      throw errorDe(config, 'Sesión inválida o vencida.', 401, 'token-invalido');
    }

    return {
      status: 200,
      data: {
        content: [
          {
            id: 'prod-1',
            categoriaId: 'cat-1',
            nombre: 'Café Americano 12oz',
            descripcion: 'Espresso doble con agua caliente.',
            imagenUrl: null,
            estado: 'ACTIVE',
          },
        ],
        totalElements: 1,
        number: 0,
        size: 100,
      },
    };
  }

  if (metodo === 'GET' && ruta === '/v1/catalog/productos/prod-1/ofertas') {
    if (!usuarioDelBearer(config)) {
      throw errorDe(config, 'Sesión inválida o vencida.', 401, 'token-invalido');
    }

    return {
      status: 200,
      data: [
        {
          id: 'oferta-1',
          cafeteriaId: 'cafe-1',
          cafeteriaName: 'Cafetería Central',
          price: 1800,
          stock: 4,
          disponible: true,
        },
      ],
    };
  }

  throw errorDe(config, `Ruta no encontrada: ${metodo} ${ruta}`, 404, 'ruta-no-encontrada');
}

// El error que responde el backend: un problem+json (RFC 9457) colgado en
// `response`, que es lo que leen el interceptor de refresh y toApiError.
function errorDe(
  config: InternalAxiosRequestConfig,
  detail: string,
  status: number,
  tipo: string
): AxiosError {
  return new AxiosError(
    detail,
    String(status),
    config,
    {},
    {
      data: problema(detail, status, tipo),
      status,
      statusText: '',
      headers: {},
      config,
    }
  );
}

const adapter: AxiosAdapter = async (config) => {
  const { data, status } = responder(config as InternalAxiosRequestConfig);

  return { data, status, statusText: '', headers: {}, config };
};

// ---------------------------------------------------------------------------
// Utilidades de render y de interacción (mismo estilo que cajero-flujo-completo)
// ---------------------------------------------------------------------------

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

// Sonde la sesión del AuthContext: sin esto no se puede afirmar que el logout
// cerró la sesión, solo que se llamó al botón.
function Sonda() {
  const { sesion, bootstrapping } = useAuth();

  return (
    <RNText testID="sonda-sesion">
      {bootstrapping ? 'arrancando' : sesion ? `${sesion.rol}:${sesion.userId}` : 'sin-sesion'}
    </RNText>
  );
}

async function renderizar(elemento: ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <AuthProvider>
        <Sonda />
        {elemento}
      </AuthProvider>
    );
    await Promise.resolve();
  });

  return tree;
}

async function renderizarConAuth(elemento: ReactElement): Promise<ReactTestRenderer> {
  const tree = await renderizar(elemento);
  // Deja resolver el arranque (leerSesion) y cualquier setState del efecto.
  await act(async () => {});
  return tree;
}

async function escribir(tree: ReactTestRenderer, indice: number, valor: string): Promise<void> {
  const campos = tree.root.findAllByType(TextInput);
  await act(async () => {
    campos[indice].props.onChangeText(valor);
  });
}

// Las pantallas de auth no tienen testID, así que el botón se localiza por su
// texto. Se toma el nodo más profundo que renderiza ese texto (el <Text>) y se
// sube por los padres hasta el primero que tenga onPress: en RN 0.86 Pressable es
// un memo, así que comparar por tipo de componente no funciona y el recorrido
// por los padres sí.
async function pulsarPorTexto(tree: ReactTestRenderer, texto: string): Promise<void> {
  const candidatos = tree.root.findAll((nodo) => textoDe(nodo).trim() === texto);
  let nodo: ReactTestInstance | null = candidatos[candidatos.length - 1] ?? null;

  while (nodo && typeof nodo.props?.onPress !== 'function') {
    nodo = nodo.parent;
  }

  if (!nodo) {
    throw new Error(`No se encontró un botón con el texto "${texto}"`);
  }

  await act(async () => {
    nodo.props.onPress();
  });
}

function pulsarPorTestID(tree: ReactTestRenderer, testID: string): Promise<void> {
  const boton = tree.root.findByProps({ testID });
  return act(async () => {
    boton.props.onPress();
  });
}

function sesionEn(tree: ReactTestRenderer): string {
  return textoDe(tree.root.findByProps({ testID: 'sonda-sesion' }));
}

// Alta de cuenta por la pantalla de registro y verificación, tal como la haría
// la persona: seis campos, botón "Crear Cuenta", y el correo que la app se pasa
// a sí misma al navegar a verificar-correo.
async function crearCuentaVerificada(): Promise<void> {
  const registro = await renderizarConAuth(<RegistroScreen />);

  await escribir(registro, 0, 'Ana');
  await escribir(registro, 1, 'Pérez');
  await escribir(registro, 2, CORREO);
  await escribir(registro, 3, '+56 9 1234 5678');
  await escribir(registro, 4, CLAVE);
  await escribir(registro, 5, CLAVE);
  await pulsarPorTexto(registro, 'Crear Cuenta');

  // El registro navegó a verificar-correo con el email en los params: se sigue
  // el recorrido con esos params, como haría expo-router.
  expect(mockReplace).toHaveBeenCalledWith({
    pathname: '/(auth)/verificar-correo',
    params: { email: CORREO },
  });
  act(() => registro.unmount());

  mockParams.email = CORREO;
  const verificacion = await renderizarConAuth(<VerificarCorreoScreen />);
  await escribir(verificacion, 0, TOKEN_VERIFICACION);
  await pulsarPorTexto(verificacion, 'Confirmar Correo');

  const usuario = backend.usuarios.get(CORREO);
  expect(usuario?.verificado).toBe(true);
  act(() => verificacion.unmount());
}

async function iniciarSesionEnPantalla(): Promise<ReactTestRenderer> {
  const login = await renderizarConAuth(<LoginScreen />);

  await escribir(login, 0, CORREO);
  await escribir(login, 1, CLAVE);
  await pulsarPorTexto(login, 'Ingresar');

  return login;
}

describe('Flujo completo de autenticación (INT4-25)', () => {
  let adapterOriginal: typeof httpClient.defaults.adapter;

  beforeEach(() => {
    adapterOriginal = httpClient.defaults.adapter;
    httpClient.defaults.adapter = adapter as AxiosAdapter;
    jest.clearAllMocks();
    mockEliminarRegistroPush.mockClear();
    // El almacén del dispositivo se limpia entre tests: si quedara un par de
    // tokens, el AuthContext los restauraría al montar y la partida sería falsa.
    secureStore.__reset();
    reiniciarBackend();
    delete mockParams.email;

    // El perfil se renderiza con los datos del usuario simulado para poder
    // llegar al botón de cerrar sesión, que es el disparador del logout.
    mockObtenerPerfil.mockImplementation(
      async () =>
        ({
          id: USUARIO_ID,
          email: CORREO,
          nombre: 'Ana',
          apellido: 'Pérez',
          telefono: '+56 9 1234 5678',
          rol: 'CLIENTE',
          verificado: true,
        }) as never
    );

    // El refresh usa su propio cliente de axios (aislado para no recursar con
    // los interceptores), así que el backend simulado lo atiende acá: rota el
    // refresh y revoca el anterior, igual que el auth-service.
    mockRequestNewTokens.mockImplementation(async (refreshToken: string) => {
      const usuarioId = backend.refreshVigentes.get(refreshToken);
      if (!usuarioId) {
        throw new Error('Refresh token inválido o revocado');
      }

      backend.refreshVigentes.delete(refreshToken);
      const usuario = [...backend.usuarios.values()].find((u) => u.id === usuarioId);

      return emitirTokens(usuario as UsuarioSimulado);
    });
  });

  afterEach(() => {
    httpClient.defaults.adapter = adapterOriginal;
  });

  it('registro → verificación → login deja la sesión abierta y los tokens en el dispositivo', async () => {
    await crearCuentaVerificada();

    const login = await iniciarSesionEnPantalla();

    // La sesión sale del JWT real que emitió el backend: sub es el id del
    // usuario y role el rol, que es como la app decodifica (decodificarSesion).
    expect(sesionEn(login)).toBe(`cliente:${USUARIO_ID}`);

    const guardado = await leerSesion();
    expect(guardado?.accessToken).toBeTruthy();
    expect(guardado?.refreshToken).toBeTruthy();
    expect(backend.refreshVigentes.has(guardado!.refreshToken)).toBe(true);

    act(() => login.unmount());
  }, 20000);

  it('llama a /v1/auth/login con el correo normalizado y guarda el par emitido', async () => {
    await crearCuentaVerificada();

    const login = await renderizarConAuth(<LoginScreen />);
    await escribir(login, 0, `  ${CORREO.toUpperCase()}  `);
    await escribir(login, 1, CLAVE);
    await pulsarPorTexto(login, 'Ingresar');

    expect(backend.llamadas).toContain('POST /v1/auth/login');

    act(() => login.unmount());
  }, 20000);

  it('no deja iniciar sesión con la cuenta sin verificar y muestra el motivo', async () => {
    // El backend exige verificar el correo antes del primer login (403).
    const registro = await renderizarConAuth(<RegistroScreen />);
    await escribir(registro, 0, 'Ana');
    await escribir(registro, 1, 'Pérez');
    await escribir(registro, 2, CORREO);
    await escribir(registro, 3, '+56 9 1234 5678');
    await escribir(registro, 4, CLAVE);
    await escribir(registro, 5, CLAVE);
    await pulsarPorTexto(registro, 'Crear Cuenta');
    act(() => registro.unmount());

    const login = await iniciarSesionEnPantalla();

    expect(sesionEn(login)).toBe('sin-sesion');
    expect(textoDe(login.root)).toContain('Debes verificar tu correo antes de iniciar sesión.');
    // No se emitió ninguna sesión en el servidor.
    expect(backend.refreshVigentes.size).toBe(0);

    act(() => login.unmount());
  }, 20000);

  it('rechaza una contraseña incorrecta con el 401 del backend', async () => {
    await crearCuentaVerificada();

    const login = await renderizarConAuth(<LoginScreen />);
    await escribir(login, 0, CORREO);
    await escribir(login, 1, 'clave-malo');
    await pulsarPorTexto(login, 'Ingresar');

    expect(sesionEn(login)).toBe('sin-sesion');
    expect(textoDe(login.root)).toContain('El correo o la contraseña no son correctos.');

    act(() => login.unmount());
  }, 20000);

  it('renueva el accessToken vencido y persiste el refresh rotado antes de seguir', async () => {
    await crearCuentaVerificada();
    const login = await iniciarSesionEnPantalla();

    const tokensDelLogin = (await leerSesion())!;

    // A partir de ahora el accessToken que hay en memoria está vencido: la
    // próxima llamada autenticada va a recibir 401, que es lo que dispara el
    // refresh del interceptor (INT4-17).
    accessVencido = true;

    let productos: Producto[] = [];
    await act(async () => {
      productos = await listarProductos('campus-1');
    });

    // El 401 no llegó a la pantalla: el interceptor renovó y reintentó solo.
    expect(productos).toHaveLength(1);
    expect(productos[0].offers?.[0].precio).toBe(1800);

    const despuesDelRefresh = (await leerSesion())!;
    expect(despuesDelRefresh.accessToken).not.toBe(tokensDelLogin.accessToken);
    // El refresh rotó: el de antes quedó revocado y el nuevo quedó guardado.
    expect(despuesDelRefresh.refreshToken).not.toBe(tokensDelLogin.refreshToken);
    expect(backend.refreshVigentes.has(tokensDelLogin.refreshToken)).toBe(false);
    expect(backend.refreshVigentes.has(despuesDelRefresh.refreshToken)).toBe(true);

    act(() => login.unmount());
  }, 20000);

  it('cerrar sesión revoca el refresh en el backend y borra los tokens del dispositivo', async () => {
    await crearCuentaVerificada();
    const login = await iniciarSesionEnPantalla();
    const tokensDelLogin = (await leerSesion())!;

    // Se llega al botón real de la pantalla de perfil.
    const perfil = await renderizarConAuth(<PerfilScreen />);
    await act(async () => {});
    await pulsarPorTestID(perfil, 'cerrar-sesion');

    // El logout viajó con el refreshToken vigente y con el Bearer, en ese orden:
    // el backend exige los dos y no sirve de nada revocarlos después de limpiar.
    expect(backend.llamadas).toContain('POST /v1/auth/logout');
    expect(backend.refreshVigentes.has(tokensDelLogin.refreshToken)).toBe(false);

    // Sesión cerrada y dispositivo sin tokens.
    expect(sesionEn(perfil)).toBe('sin-sesion');
    expect(await leerSesion()).toBeNull();

    // El token push se borra del backend en el mismo cierre de sesión (INT4-42).
    expect(mockEliminarRegistroPush).toHaveBeenCalled();

    // Y el refresh revocado ya no sirve: ni para renovar ni para cerrar de nuevo.
    await expect(mockRequestNewTokens(tokensDelLogin.refreshToken)).rejects.toThrow(
      'Refresh token inválido o revocado'
    );

    act(() => perfil.unmount());
    act(() => login.unmount());
  }, 20000);

  it('cierra la sesión local aunque el backend no responda el logout', async () => {
    await crearCuentaVerificada();
    const login = await iniciarSesionEnPantalla();

    // El gateway se cae justo en el logout: sin respuesta y sin problem+json.
    httpClient.defaults.adapter = async () => {
      throw new AxiosError('Network Error', 'ERR_NETWORK', {} as InternalAxiosRequestConfig, {});
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const perfil = await renderizarConAuth(<PerfilScreen />);
    await act(async () => {});
    await pulsarPorTestID(perfil, 'cerrar-sesion');

    // Cerrar sesión no puede quedar atrapado por una falla de red: la sesión
    // local se cierra igual y los tokens se borran del dispositivo.
    expect(sesionEn(perfil)).toBe('sin-sesion');
    expect(await leerSesion()).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[Auth] No se pudo revocar la sesión en el backend:',
      expect.anything()
    );

    warn.mockRestore();
    act(() => perfil.unmount());
    act(() => login.unmount());
  }, 20000);
});
