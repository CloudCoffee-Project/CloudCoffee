// src/services/historialNotificaciones.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Notification } from 'expo-notifications';

import {
  agregarNotificacion,
  contarNoLeidas,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  paraHistorial,
  vaciarHistorial,
  type NotificacionHistorial,
} from './historialNotificaciones';

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
}));

// expo-notifications carga módulos nativos al importar (notificacionesPush lo
// requiere); basta la superficie mínima que toca el historial.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  IosAuthorizationStatus: { PROVISIONAL: 1 },
}));

const mockGetItem = AsyncStorage.getItem as unknown as jest.Mock;
const mockSetItem = AsyncStorage.setItem as unknown as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as unknown as jest.Mock;

const FECHA_MS = 1_700_000_000_000;

function notificacionExpo(
  id: string,
  titulo: string | undefined,
  cuerpo: string | undefined,
  data: Record<string, unknown> = {}
): Notification {
  return {
    date: FECHA_MS,
    request: { identifier: id, content: { title: titulo, body: cuerpo, data } },
  } as unknown as Notification;
}

function registro(id: string, sobre: Partial<NotificacionHistorial> = {}): NotificacionHistorial {
  return {
    id,
    titulo: 'Título',
    cuerpo: 'Cuerpo',
    url: null,
    leida: false,
    fechaIso: '2026-09-25T00:00:00.000Z',
    ...sobre,
  };
}

describe('paraHistorial', () => {
  it('convierte una Notification en un registro de la bandeja', () => {
    const registroBandeja = paraHistorial(
      notificacionExpo('n-1', '  Pedido listo  ', '  Retira tu café  ', {
        url: '/(cliente)/mis-compras',
      })
    );

    expect(registroBandeja).toEqual({
      id: 'n-1',
      titulo: 'Pedido listo',
      cuerpo: 'Retira tu café',
      url: '/(cliente)/mis-compras',
      leida: false,
      fechaIso: new Date(FECHA_MS).toISOString(),
    });
  });

  it('devuelve null para notificaciones data-only (sin título ni cuerpo)', () => {
    expect(paraHistorial(notificacionExpo('n-2', undefined, undefined, { url: '/' }))).toBeNull();
  });

  it('rechaza URLs que no son rutas internas seguras', () => {
    const registroBandeja = paraHistorial(
      notificacionExpo('n-3', 'T', 'C', { url: 'https://sitio-externo.cl/x' })
    );
    expect(registroBandeja?.url).toBeNull();
    expect(registroBandeja?.titulo).toBe('T');
  });

  it('usa un id de respaldo cuando el identificador viene vacío', () => {
    const registroBandeja = paraHistorial(notificacionExpo('', 'T', 'C', {}));
    expect(registroBandeja?.id).toMatch(/^n-/);
  });
});

describe('listarNotificaciones', () => {
  it('devuelve [] si no hay historial guardado', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await expect(listarNotificaciones()).resolves.toEqual([]);
  });

  it('devuelve [] si el JSON guardado está corrupto', async () => {
    mockGetItem.mockResolvedValueOnce('esto-no-es-json');
    await expect(listarNotificaciones()).resolves.toEqual([]);
  });

  it('devuelve [] si lo guardado no es una lista', async () => {
    mockGetItem.mockResolvedValueOnce('{"no":"un-array"}');
    await expect(listarNotificaciones()).resolves.toEqual([]);
  });

  it('devuelve la lista persistida', async () => {
    const lista = [registro('n-1'), registro('n-2')];
    mockGetItem.mockResolvedValueOnce(JSON.stringify(lista));
    await expect(listarNotificaciones()).resolves.toEqual(lista);
  });
});

describe('agregarNotificacion', () => {
  it('inserta al inicio, reemplaza por id y persiste', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify([registro('n-1'), registro('n-2')]));
    const resultado = await agregarNotificacion({
      ...registro('n-2', { titulo: 'Nuevo título', leida: true }),
    });

    expect(resultado.map((n) => n.id)).toEqual(['n-2', 'n-1']);
    expect(resultado[0]).toEqual(
      expect.objectContaining({ id: 'n-2', titulo: 'Nuevo título', leida: true })
    );
    expect(mockSetItem).toHaveBeenCalledWith(
      '@app_notificaciones_historial',
      JSON.stringify(resultado)
    );
  });

  it('acota el historial a las 30 más recientes', async () => {
    const previas = Array.from({ length: 30 }, (_, i) => registro(`n-${i}`));
    mockGetItem.mockResolvedValueOnce(JSON.stringify(previas));

    const resultado = await agregarNotificacion(registro('n-nueva'));

    expect(resultado).toHaveLength(30);
    expect(resultado[0].id).toBe('n-nueva');
    expect(resultado.some((n) => n.id === 'n-29')).toBe(false);
  });
});

describe('leídas, conteo y vaciado', () => {
  it('marca una notificación como leída sin tocar las demás', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify([registro('n-1'), registro('n-2')]));

    const resultado = await marcarLeida('n-1');

    expect(resultado.find((n) => n.id === 'n-1')?.leida).toBe(true);
    expect(resultado.find((n) => n.id === 'n-2')?.leida).toBe(false);
  });

  it('marca todas como leídas', async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([registro('n-1'), registro('n-2', { leida: true })])
    );

    const resultado = await marcarTodasLeidas();

    expect(resultado.every((n) => n.leida)).toBe(true);
  });

  it('cuenta las no leídas', async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify([registro('n-1'), registro('n-2', { leida: true })])
    );
    await expect(contarNoLeidas()).resolves.toBe(1);
  });

  it('vacía el historial', async () => {
    await vaciarHistorial();
    expect(mockRemoveItem).toHaveBeenCalledWith('@app_notificaciones_historial');

    mockGetItem.mockResolvedValueOnce(null);
    await expect(listarNotificaciones()).resolves.toEqual([]);
  });
});
