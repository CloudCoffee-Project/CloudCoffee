// src/services/sessionStorage.test.ts
import * as SecureStore from 'expo-secure-store';

import { eliminarSesion, guardarSesion, leerSesion } from './sessionStorage';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __reset: () => {
      store.clear();
    },
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

const mockedSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockedGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockedDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
const mockedSecureStoreModule = SecureStore as unknown as { __reset: () => void };

describe('sessionStorage (INT4-22)', () => {
  beforeEach(() => {
    mockedSecureStoreModule.__reset();
    jest.clearAllMocks();
  });

  describe('guardarSesion', () => {
    it('persiste cada token en su propia clave de SecureStore', async () => {
      await guardarSesion({ accessToken: 'a', refreshToken: 'r' });

      expect(mockedSetItemAsync).toHaveBeenCalledWith('app.sesion.access_token', 'a');
      expect(mockedSetItemAsync).toHaveBeenCalledWith('app.sesion.refresh_token', 'r');
    });
  });

  describe('leerSesion', () => {
    it('devuelve ambos tokens cuando existen', async () => {
      await guardarSesion({ accessToken: 'a', refreshToken: 'r' });

      await expect(leerSesion()).resolves.toEqual({ accessToken: 'a', refreshToken: 'r' });
    });

    it('devuelve null cuando no hay sesión guardada', async () => {
      await expect(leerSesion()).resolves.toBeNull();
    });

    it('devuelve null cuando falta uno de los dos tokens', async () => {
      mockedGetItemAsync.mockResolvedValueOnce('a');
      await expect(leerSesion()).resolves.toBeNull();
    });
  });

  describe('eliminarSesion', () => {
    it('borra ambas claves de SecureStore', async () => {
      await eliminarSesion();

      expect(mockedDeleteItemAsync).toHaveBeenCalledWith('app.sesion.access_token');
      expect(mockedDeleteItemAsync).toHaveBeenCalledWith('app.sesion.refresh_token');
    });
  });
});
