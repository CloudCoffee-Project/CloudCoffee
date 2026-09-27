// src/hooks/useNotificacionesPush.test.ts
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Notification, NotificationResponse } from 'expo-notifications';

import { useNotificacionesPush } from './useNotificacionesPush';
import { agregarNotificacion } from '../services/historialNotificaciones';

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
}));

// expo-notifications carga módulos nativos y registra auto-registration al
// importar; se mockea la superficie que usa el hook y se capturan los
// listeners para poder invocarlos desde los tests.
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
  IosAuthorizationStatus: { PROVISIONAL: 1, AUTHORIZED: 2 },
}));

// Se mantienen las funciones reales del historial salvo agregarNotificacion,
// que se espía para verificar qué se persiste en la bandeja.
jest.mock('../services/historialNotificaciones', () => {
  const actual = jest.requireActual('../services/historialNotificaciones');
  return { ...actual, agregarNotificacion: jest.fn(async () => []) };
});

const mockAgregar = agregarNotificacion as unknown as jest.Mock;

const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

function notificacion(
  id: string,
  titulo: string | undefined,
  cuerpo: string | undefined,
  data: Record<string, unknown> = {}
): Notification {
  return {
    date: 1_700_000_000_000,
    request: { identifier: id, content: { title: titulo, body: cuerpo, data } },
  } as unknown as Notification;
}

function respuestaDe(n: Notification): NotificationResponse {
  return { actionIdentifier: DEFAULT_ACTION, notification: n } as unknown as NotificationResponse;
}

function Sonda({ onAbrir }: { onAbrir: (url: string) => void }) {
  const { ultimaNotificacion } = useNotificacionesPush(onAbrir, false);
  return <Text>{ultimaNotificacion?.titulo ?? 'nada'}</Text>;
}

// Último listener registrado por el hook (el del render más reciente).
function ultimoListener(metodo: keyof typeof Notifications): (arg: never) => void {
  const modulos = Notifications as unknown as Record<string, unknown>;
  const mock = modulos[metodo] as unknown as jest.Mock;
  const llamadas = mock.mock.calls;
  return llamadas[llamadas.length - 1][0];
}

async function renderizarSonda(onAbrir: (url: string) => void): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Sonda onAbrir={onAbrir} />);
  });
  return tree;
}

beforeEach(() => {
  mockAgregar.mockClear();
  (Notifications.getLastNotificationResponseAsync as unknown as jest.Mock).mockResolvedValue(null);
});

describe('useNotificacionesPush', () => {
  it('al recibir una notificación en primer plano la persiste sin leer y la expone', async () => {
    const tree = await renderizarSonda(jest.fn());
    const listenerRecibida = ultimoListener('addNotificationReceivedListener');

    await act(async () => {
      listenerRecibida(
        notificacion('n-1', 'Pedido listo', 'Retira tu café', {
          url: '/(cliente)/mis-compras',
        }) as never
      );
    });

    expect(mockAgregar).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'n-1',
        titulo: 'Pedido listo',
        cuerpo: 'Retira tu café',
        url: '/(cliente)/mis-compras',
        leida: false,
      })
    );
    expect(tree.root.findByType(Text).props.children).toBe('Pedido listo');
  });

  it('descarta data-only (sin título ni cuerpo) y no la persiste', async () => {
    await renderizarSonda(jest.fn());
    const listenerRecibida = ultimoListener('addNotificationReceivedListener');

    await act(async () => {
      listenerRecibida(notificacion('n-sin-contenido', undefined, undefined, {}) as never);
    });

    expect(mockAgregar).not.toHaveBeenCalled();
  });

  it('al tocar la notificación la persiste leída y navega a data.url', async () => {
    const onAbrir = jest.fn();
    await renderizarSonda(onAbrir);
    const listenerRespuesta = ultimoListener('addNotificationResponseReceivedListener');

    await act(async () => {
      listenerRespuesta(
        respuestaDe(
          notificacion('n-2', 'Pago confirmado', 'Tu pago fue exitoso', {
            url: '/(cliente)/mis-compras',
          })
        ) as never
      );
    });

    expect(mockAgregar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n-2', leida: true, url: '/(cliente)/mis-compras' })
    );
    expect(onAbrir).toHaveBeenCalledWith('/(cliente)/mis-compras');
  });

  it('al tocar una notificación sin url la persiste leída sin navegar', async () => {
    const onAbrir = jest.fn();
    await renderizarSonda(onAbrir);
    const listenerRespuesta = ultimoListener('addNotificationResponseReceivedListener');

    await act(async () => {
      listenerRespuesta(respuestaDe(notificacion('n-3', 'Promo', 'Café 2x1', {})) as never);
    });

    expect(mockAgregar).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-3', leida: true }));
    expect(onAbrir).not.toHaveBeenCalled();
  });

  it('en arranque en frío procesa la última respuesta abierta', async () => {
    const onAbrir = jest.fn();
    (Notifications.getLastNotificationResponseAsync as unknown as jest.Mock).mockResolvedValue(
      respuestaDe(
        notificacion('n-4', 'Retiro listo', 'Tu café te espera', {
          url: '/(cliente)/mis-compras',
        })
      )
    );

    await renderizarSonda(onAbrir);

    expect(mockAgregar).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-4', leida: true }));
    expect(onAbrir).toHaveBeenCalledWith('/(cliente)/mis-compras');
  });
});
