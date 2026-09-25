// src/__tests__/cliente-bandeja.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import BandejaNotificacionesScreen from '../app/(cliente)/notificaciones';
import {
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  vaciarHistorial,
} from '../services/historialNotificaciones';
import { useFocusEffect } from 'expo-router';
import type { NotificacionHistorial } from '../services/historialNotificaciones';

const mockPush = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  IosAuthorizationStatus: { PROVISIONAL: 1, AUTHORIZED: 2 },
}));

// El historial usa AsyncStorage real (mockeado arriba); solo se reemplazan las
// funciones que la pantalla invoca para poder controlar sus resultados.
jest.mock('../services/historialNotificaciones', () => {
  const actual = jest.requireActual('../services/historialNotificaciones');
  return {
    ...actual,
    listarNotificaciones: jest.fn(async () => []),
    marcarLeida: jest.fn(async () => []),
    marcarTodasLeidas: jest.fn(async () => []),
    vaciarHistorial: jest.fn(async () => undefined),
  };
});

jest.mock('../services/notificacionesPush', () => {
  const actual = jest.requireActual('../services/notificacionesPush');
  return { ...actual, obtenerTokenGuardado: jest.fn(async () => 'token-testeo') };
});

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: jest.fn(() => ({ push: mockPush })),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: (props: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(View, props, props.children),
  };
});

const mockListar = listarNotificaciones as unknown as jest.Mock;
const mockMarcarLeida = marcarLeida as unknown as jest.Mock;
const mockMarcarTodas = marcarTodasLeidas as unknown as jest.Mock;
const mockVaciar = vaciarHistorial as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;

function registro(id: string, sobre: Partial<NotificacionHistorial> = {}): NotificacionHistorial {
  return {
    id,
    titulo: 'Título',
    cuerpo: 'Cuerpo',
    url: null,
    leida: false,
    fechaIso: new Date().toISOString(),
    ...sobre,
  };
}

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

// Renderiza la pantalla y ejecuta el callback que el mock de useFocusEffect
// capturó (equivale a que la pantalla gane foco y recargue el historial).
async function renderizarBandeja(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<BandejaNotificacionesScreen />);
  });

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });

  return tree;
}

beforeEach(() => {
  mockPush.mockClear();
  mockListar.mockResolvedValue([]);
  mockMarcarLeida.mockResolvedValue([]);
  mockMarcarTodas.mockResolvedValue([]);
  mockVaciar.mockResolvedValue(undefined);
});

describe('pantalla de notificaciones (bandeja)', () => {
  it('muestra el estado vacío cuando no hay notificaciones', async () => {
    const tree = await renderizarBandeja();

    expect(tree.root.findByProps({ testID: 'bandeja-vacia' })).toBeDefined();
    const items = tree.root.findAll(
      (nodo) =>
        typeof nodo.props.testID === 'string' && nodo.props.testID.startsWith('notificacion-item-')
    );
    expect(items).toHaveLength(0);
  });

  it('lista el historial con título, cuerpo y estado de leída', async () => {
    mockListar.mockResolvedValue([
      registro('n-1', { titulo: 'Pedido listo', cuerpo: 'Retira tu café', leida: false }),
      registro('n-2', { titulo: 'Pago confirmado', url: '/(cliente)/mis-compras', leida: true }),
    ]);

    const tree = await renderizarBandeja();

    const item1 = tree.root.findByProps({ testID: 'notificacion-item-n-1' });
    expect(textoDe(item1)).toContain('Pedido listo');
    expect(textoDe(item1)).toContain('Retira tu café');

    const item2 = tree.root.findByProps({ testID: 'notificacion-item-n-2' });
    expect(textoDe(item2)).toContain('Pago confirmado');
  });

  it('al tocar una no leída la marca leída y navega si trae url', async () => {
    mockListar.mockResolvedValue([
      registro('n-2', { titulo: 'Pago confirmado', url: '/(cliente)/mis-compras', leida: false }),
    ]);

    const tree = await renderizarBandeja();

    const item = tree.root.findByProps({ testID: 'notificacion-item-n-2' });
    await act(async () => {
      item.props.onPress();
    });

    expect(mockMarcarLeida).toHaveBeenCalledWith('n-2');
    expect(mockPush).toHaveBeenCalledWith('/(cliente)/mis-compras');
  });

  it('al tocar una no leída sin url la marca leída sin navegar', async () => {
    mockListar.mockResolvedValue([
      registro('n-1', { titulo: 'Promo', cuerpo: 'Café 2x1', leida: false }),
    ]);

    const tree = await renderizarBandeja();

    const item = tree.root.findByProps({ testID: 'notificacion-item-n-1' });
    await act(async () => {
      item.props.onPress();
    });

    expect(mockMarcarLeida).toHaveBeenCalledWith('n-1');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('marca todas como leídas desde la acción de la bandeja', async () => {
    mockListar.mockResolvedValue([
      registro('n-1', { leida: false }),
      registro('n-2', { leida: false }),
    ]);

    const tree = await renderizarBandeja();

    const boton = tree.root.findByProps({ testID: 'marcar-todas-leidas' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(mockMarcarTodas).toHaveBeenCalledTimes(1);
  });

  it('vacía la bandeja desde la acción y muestra el estado vacío', async () => {
    mockListar.mockResolvedValue([registro('n-1', { titulo: 'Pedido listo' })]);

    const tree = await renderizarBandeja();
    expect(tree.root.findAllByProps({ testID: 'bandeja-vacia' })).toHaveLength(0);

    const boton = tree.root.findByProps({ testID: 'vaciar-bandeja' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(mockVaciar).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({ testID: 'bandeja-vacia' })).toBeDefined();
  });
});
