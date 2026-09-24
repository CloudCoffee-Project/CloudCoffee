// src/services/notificacionesPush.test.ts
import { Platform } from 'react-native';

import { httpClient } from './httpClient';
import { registrarTokenEnBackend, urlDeNotificacion } from './notificacionesPush';

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
}));

// expo-notifications carga módulos nativos y registra auto-registration al
// importar; se mockea la superficie que usa el servicio para aislar el test.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'token-fcm', type: 'android' })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { HIGH: 6, MAX: 7 },
  IosAuthorizationStatus: {
    NOT_DETERMINED: 0,
    DENIED: 1,
    AUTHORIZED: 2,
    PROVISIONAL: 3,
    EPHEMERAL: 4,
  },
}));

describe('urlDeNotificacion', () => {
  it('extrae una ruta interna válida desde data.url', () => {
    expect(urlDeNotificacion({ url: '/(cliente)/orden/abc' })).toBe('/(cliente)/orden/abc');
  });

  it('devuelve null cuando no hay url', () => {
    expect(urlDeNotificacion(undefined)).toBeNull();
    expect(urlDeNotificacion({})).toBeNull();
    expect(urlDeNotificacion({ url: 42 })).toBeNull();
  });

  it('ignora enlaces externos (protocolo o //)', () => {
    expect(urlDeNotificacion({ url: 'https://evil.example.com' })).toBeNull();
    expect(urlDeNotificacion({ url: '//evil.example.com' })).toBeNull();
  });

  it('ignora rutas que no son internas (sin / inicial)', () => {
    expect(urlDeNotificacion({ url: 'cliente/carrito' })).toBeNull();
  });

  it('nunca navega a flujos de autenticación desde una notificación', () => {
    expect(urlDeNotificacion({ url: '/(auth)/login' })).toBeNull();
  });
});

describe('registrarTokenEnBackend', () => {
  it('registra el token contra el gateway con la plataforma actual', async () => {
    const post = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: {} } as never);

    await registrarTokenEnBackend('token-fcm-1');

    expect(post).toHaveBeenCalledWith('/v1/notifications/device-token', {
      token: 'token-fcm-1',
      plataforma: Platform.OS,
    });
    post.mockRestore();
  });

  it('resuelve sin lanzar si el backend aún no tiene el endpoint', async () => {
    const post = jest.spyOn(httpClient, 'post').mockRejectedValue(new Error('404'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(registrarTokenEnBackend('token-fcm-2')).resolves.toBeUndefined();
    post.mockRestore();
    jest.restoreAllMocks();
  });
});
