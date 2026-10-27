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

// ---------------------------------------------------------------------------
// expo-router
// ---------------------------------------------------------------------------

/** Router falso: el mismo objeto que devuelve `useRouter` en las suites. */
export const routerMock = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
};

/** Limpia las llamadas del router falso sin tocar sus implementaciones. */
export function limpiarRouter(): void {
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  routerMock.back.mockClear();
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
  useRouter: jest.fn(() => routerMock),
  useFocusEffect: jest.fn(),
  useIsFocused: jest.fn(() => true),
  useLocalSearchParams: jest.fn(() => ({}) as Record<string, string | string[]>),
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
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
  SafeAreaView: (props: { children?: ReactNode } & Record<string, unknown>) =>
    React.createElement(jest.requireActual('react-native').View, props, props.children),
};

// ---------------------------------------------------------------------------
// expo-secure-store
// ---------------------------------------------------------------------------

interface MockSecureStore {
  /** Vacía el almacén en memoria entre tests. */
  __reset: () => void;
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
}

/**
 * Mock de `expo-secure-store` respaldado por un mapa en memoria. Es una
 * fábrica y no un singleton porque cada suite que lo use necesita un `__reset`
 * propio para dejar el "dispositivo" sin tokens entre tests.
 */
export function crearMockSecureStore(): MockSecureStore {
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
}

// ---------------------------------------------------------------------------
// @react-native-async-storage/async-storage
// ---------------------------------------------------------------------------

/**
 * Mock de AsyncStorage. Por defecto `getItem` devuelve `null` (no hay valor
 * guardado); la suite que lo necesite lo ajusta con `mockResolvedValue`.
 */
export const asyncStorageMock = {
  getItem: jest.fn(async () => null as string | null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => [] as string[]),
};

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
