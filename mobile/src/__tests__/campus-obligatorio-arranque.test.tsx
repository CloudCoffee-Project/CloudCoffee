// src/__tests__/campus-obligatorio-arranque.test.tsx
//
// INT4-126 (A1T): pruebas del arranque con campus obligatorio. A diferencia de
// cliente-campus.test.tsx (que prueba la pantalla) y auth-flujo-completo.test.tsx
// (que prueba el login/logout), acá se recorre el ciclo que hace la persona:
//
//   1. arrancar sin sede guardada → el guard manda a /(cliente)/campus;
//   2. Continuar queda deshabilitado hasta tocar una tarjeta;
//   3. al confirmar, la sede se persiste y un nuevo arranque NO vuelve a pedirla.
//
// El root layout se monta de verdad; se mockean solo nativos y las pantallas
// vecinas. La persistencia es la real de services/catalog sobre un AsyncStorage
// en memoria, para que "reabrir la app" signifique volver a leer el almacén.

import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

import RootLayout from '../app/_layout';
import CampusScreen from '../app/(cliente)/campus';
import { guardarCampusSeleccionado, leerCampusSeleccionado } from '../services/catalog';
import { CAMPUS_STORAGE_KEY } from '../services/campus';
import { asyncStorageMock } from '../test-utils';
import type { Campus } from '../types/domain';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

jest.mock('expo-router', () => {
  const router = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
  return {
    Slot: () => null,
    useRouter: () => router,
    useSegments: jest.fn(() => ['(cliente)']),
    useFocusEffect: jest.fn(),
    __router: router,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('../test-utils').safeAreaContextMock,
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Se mantiene la persistencia real (leer/guardar/limpiar) y se reemplaza solo
// la llamada de red: el listado de campus no es parte de esta suite.
jest.mock('../services/catalog', () => ({
  ...jest.requireActual('../services/catalog'),
  listarCampus: jest.fn(),
}));

const mockUseAuth = jest.fn();
jest.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../context/CarritoContext', () => ({
  CarritoProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../hooks/useNotificacionesPush', () => ({
  useNotificacionesPush: () => ({ estado: { mensaje: null }, ultimaNotificacion: null }),
}));

jest.mock('../hooks/useNotificacionesStock', () => ({
  useNotificacionesStock: () => ({ ultimaNotificacion: null }),
}));

jest.mock('../hooks/useCafeteriaActual', () => ({
  useCafeteriaActual: () => null,
}));

jest.mock('../services/websocket', () => ({
  connectWebSocket: jest.fn(),
  disconnectWebSocket: jest.fn(),
}));

jest.mock('../components/BannerNotificacionPush', () => () => null);

type RouterFalso = { replace: jest.Mock; push: jest.Mock; back: jest.Mock };
const router = (jest.requireMock('expo-router') as { __router: RouterFalso }).__router;
const useSegments = jest.requireMock('expo-router').useSegments as jest.Mock;
const useFocusEffect = jest.requireMock('expo-router').useFocusEffect as jest.Mock;
const mockListarCampus = jest.requireMock('../services/catalog').listarCampus as jest.Mock;
const mockGetItem = asyncStorageMock.getItem as jest.Mock;
const mockSetItem = asyncStorageMock.setItem as jest.Mock;
const mockRemoveItem = asyncStorageMock.removeItem as jest.Mock;

const campusMock: Campus[] = [
  { id: 'campus-1', nombre: 'Campus San Francisco', direccion: 'Manuel Montt 056, Temuco' },
  { id: 'campus-2', nombre: 'Campus San Juan Pablo II', direccion: 'Peligde, Temuco' },
];

const arboles: ReactTestRenderer[] = [];

async function renderizarRoot(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<RootLayout />);
  });
  arboles.push(tree);
  return tree;
}

async function renderizarCampus(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<CampusScreen />);
  });
  arboles.push(tree);

  // El mock captura el callback; ejecutarlo equivale a que la pantalla gane foco.
  const llamadas = useFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });
  return tree;
}

beforeEach(() => {
  // Almacén en memoria compartido por todos los mount: sobrevive a un unmount
  // y por eso sirve para simular "cerrar y reabrir la app".
  const almacen = new Map<string, string>();
  mockGetItem.mockImplementation(async (clave: string) => almacen.get(clave) ?? null);
  mockSetItem.mockImplementation(async (clave: string, valor: string) => {
    almacen.set(clave, valor);
  });
  mockRemoveItem.mockImplementation(async (clave: string) => {
    almacen.delete(clave);
  });

  useSegments.mockReturnValue(['(cliente)']);
  useFocusEffect.mockReset();
  router.replace.mockClear();
  router.push.mockClear();
  router.back.mockClear();
  mockListarCampus.mockResolvedValue(campusMock);
  mockUseAuth.mockReturnValue({
    sesion: { userId: 'u-cliente', rol: 'cliente', exp: 0 },
    bootstrapping: false,
    iniciarSesion: jest.fn(),
    cerrarSesion: jest.fn(),
  });
});

afterEach(() => {
  while (arboles.length > 0) {
    const arbol = arboles.pop();
    act(() => arbol?.unmount());
  }
});

describe('Campus obligatorio al arrancar (INT4-126)', () => {
  it('sin campus guardado redirige a la selección y lee la clave canónica', async () => {
    await renderizarRoot();

    expect(mockGetItem).toHaveBeenCalledWith(CAMPUS_STORAGE_KEY);
    expect(router.replace).toHaveBeenCalledWith('/(cliente)/campus');
    expect(router.replace).not.toHaveBeenCalledWith('/(cliente)');
  });

  it('Continuar queda deshabilitado hasta que se elige una sede', async () => {
    const pantalla = await renderizarCampus();
    const continuar = pantalla.root.findByProps({ testID: 'campus-confirmar' });

    expect(continuar.props.disabled).toBe(true);

    await act(async () => {
      pantalla.root.findByProps({ testID: 'campus-card-campus-1' }).props.onPress();
    });

    expect(pantalla.root.findByProps({ testID: 'campus-confirmar' }).props.disabled).toBe(false);
  });

  it('recuerda la sede elegida al reabrir la app', async () => {
    // Primer arranque: sin sede, el guard pide la selección.
    await renderizarRoot();
    expect(router.replace).toHaveBeenCalledWith('/(cliente)/campus');

    // La persona elige y confirma: eso persiste la sede en el dispositivo.
    await act(async () => {
      await guardarCampusSeleccionado(campusMock[0]);
    });
    expect(await leerCampusSeleccionado()).toEqual(campusMock[0]);

    // Cerrar la app y volver a abrirla con el mismo almacén: ya no debe pedirla.
    while (arboles.length > 0) {
      act(() => arboles.pop()?.unmount());
    }
    router.replace.mockClear();

    await renderizarRoot();

    expect(mockGetItem).toHaveBeenCalledWith(CAMPUS_STORAGE_KEY);
    expect(router.replace).not.toHaveBeenCalledWith('/(cliente)/campus');
  });
});
