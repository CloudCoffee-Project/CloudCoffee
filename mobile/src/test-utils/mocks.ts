// src/test-utils/mocks.ts
//
// Dobles compartidos de los módulos nativos que casi todas las suites de
// pantallas necesitan reemplazar (expo-router, safe-area-context, SecureStore y
// AsyncStorage). Se exponen como objetos ya construidos para que la suite los
// use desde la fábrica de `jest.mock` con `jest.requireActual('../test-utils')`
// y, además, pueda afirmar sobre los mismos `jest.fn` (por ejemplo, que el
// router navegó). Cada archivo de test corre en su propio registro de módulos,
// así que estos singletons no se mezclan entre suites.
import React from 'react';
import type { ReactNode } from 'react';

const getRNView = () => {
  try {
    if (typeof jest !== 'undefined' && (jest as any).requireActual) {
      return (jest as any).requireActual('react-native').View;
    }
  } catch {}
  return React.Fragment;
};

// ---------------------------------------------------------------------------
// expo-router
// ---------------------------------------------------------------------------

const createMockFn = () => {
  if (typeof jest !== 'undefined' && typeof jest.fn === 'function') {
    return jest.fn();
  }
  const fn: any = () => fn;
  fn.mockClear = () => fn;
  fn.mockReset = () => fn;
  fn.mockImplementation = () => fn;
  fn.mockReturnValue = () => fn;
  fn.mockResolvedValue = () => fn;
  fn.mockRejectedValue = () => fn;
  return fn;
};

/** Router falso: el mismo objeto que devuelve `useRouter` en las suites. */
export const routerMock = {
  push: createMockFn(),
  replace: createMockFn(),
  back: createMockFn(),
};

/** Limpia las llamadas del router falso sin tocar sus implementaciones. */
export function limpiarRouter(): void {
  routerMock.push.mockClear?.();
  routerMock.replace.mockClear?.();
  routerMock.back.mockClear?.();
}

/**
 * Mock de `expo-router`. `useLocalSearchParams` arranca vacío a propósito: la
 * suite que lo necesite lo ajusta con `(useLocalSearchParams as jest.Mock)`.
 */
export const expoRouterMock = {
  // Getter y no un valor fijo: la fábrica del mock corre cuando se importa la
  // pantalla, así que el router se resuelve recién cuando el botón lo usa.
  get router() {
    return routerMock;
  },
  useRouter: (typeof jest !== 'undefined' && (jest as any).fn
    ? (jest as any).fn(() => routerMock)
    : () => routerMock) as any,
  useFocusEffect: (typeof jest !== 'undefined' && (jest as any).fn
    ? (jest as any).fn()
    : () => {}) as any,
  useIsFocused: (typeof jest !== 'undefined' && (jest as any).fn
    ? (jest as any).fn(() => true)
    : () => true) as any,
  useLocalSearchParams: (typeof jest !== 'undefined' && (jest as any).fn
    ? (jest as any).fn(() => ({}))
    : () => ({})) as any,
};

// ---------------------------------------------------------------------------
// react-native-safe-area-context
// ---------------------------------------------------------------------------

/**
 * Mock de `react-native-safe-area-context`: `SafeAreaView` se reemplaza por un
 * `View` y los insets quedan en cero. Cubre tanto las pantallas que solo usan
 * `SafeAreaView` como las que leen `useSafeAreaInsets`.
 */
export const safeAreaContextMock = {
  useSafeAreaInsets: (typeof jest !== 'undefined' && (jest as any).fn
    ? (jest as any).fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 }))
    : () => ({ top: 0, bottom: 0, left: 0, right: 0 })) as any,
  SafeAreaView: (props: { children?: ReactNode } & Record<string, unknown>) =>
    React.createElement(getRNView() as any, props, props.children),
};

// ---------------------------------------------------------------------------
// expo-secure-store
// ---------------------------------------------------------------------------

interface MockSecureStore {
  /** Vacía el almacén en memoria entre tests. */
  __reset: () => void;
  setItemAsync: any;
  getItemAsync: any;
  deleteItemAsync: any;
}

/**
 * Mock de `expo-secure-store` respaldado por un mapa en memoria. Es una
 * fábrica y no un singleton porque cada suite que lo use necesita un `__reset`
 * propio para dejar el "dispositivo" sin tokens entre tests.
 */
export function crearMockSecureStore(): MockSecureStore {
  const store = new Map<string, string>();
  const mk = () => {
    if (typeof jest !== 'undefined' && typeof (jest as any).fn === 'function') {
      return (jest as any).fn();
    }
    const fn: any = () => fn;
    fn.mockClear = () => fn;
    fn.mockReset = () => fn;
    fn.mockImplementation = () => fn;
    return fn;
  };

  const mock: any = {
    __reset: () => store.clear(),
    setItemAsync: mk(),
    getItemAsync: mk(),
    deleteItemAsync: mk(),
  };
  mock.setItemAsync.mockImplementation?.(async (key: string, value: string) => {
    store.set(key, value);
  });
  mock.getItemAsync.mockImplementation?.(async (key: string) => store.get(key) ?? null);
  mock.deleteItemAsync.mockImplementation?.(async (key: string) => {
    store.delete(key);
  });
  return mock;
}

// ---------------------------------------------------------------------------
// @react-native-async-storage/async-storage
// ---------------------------------------------------------------------------

/**
 * Mock de AsyncStorage. Por defecto `getItem` devuelve `null` (no hay valor
 * guardado); la suite que lo necesite lo ajusta con `mockResolvedValue`.
 */
export const asyncStorageMock = {
  getItem: createMockFn(),
  setItem: createMockFn(),
  removeItem: createMockFn(),
  clear: createMockFn(),
  getAllKeys: createMockFn(),
} as any;
(async () => {
  (asyncStorageMock as any).getItem.mockImplementation?.(async () => null as string | null);
  (asyncStorageMock as any).setItem.mockImplementation?.(async () => undefined);
  (asyncStorageMock as any).removeItem.mockImplementation?.(async () => undefined);
  (asyncStorageMock as any).clear.mockImplementation?.(async () => undefined);
  (asyncStorageMock as any).getAllKeys.mockImplementation?.(async () => [] as string[]);
})();

// ---------------------------------------------------------------------------
// Promesas controladas
// ---------------------------------------------------------------------------

/**
 * Promesa que no se resuelve nunca. Deja la pantalla en su estado de carga
 * durante todo el test, que es lo que necesitan las aserciones del esqueleto
 * (INT4-108).
 */
export function promesaPendiente<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}
