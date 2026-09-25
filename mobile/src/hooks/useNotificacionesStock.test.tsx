// src/hooks/useNotificacionesStock.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import type { IMessage } from '@stomp/stompjs';

import { useNotificacionesStock } from './useNotificacionesStock';
import { agregarNotificacion } from '../services/historialNotificaciones';
import { subscribeToTopic } from '../services/websocket';

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
}));

// historialNotificaciones (requireActual) importa notificacionesPush, que
// requiere expo-notifications de forma diferida; se mockea para que el
// require no lance ni ensucie la salida en Jest.
jest.mock('expo-notifications', () => ({}));

// Se mockea la suscripción al WebSocket: subscribeToTopic queda esperando que
// el test invoque el callback que el hook registró (como haría el backend).
jest.mock('../services/websocket', () => ({
  topicCafeteriaStock: jest.fn((id: string) => `/topic/cafeteria/${id}/stock`),
  subscribeToTopic: jest.fn(() => () => {}),
}));

// Se mantienen las funciones reales del historial salvo agregarNotificacion,
// que se espía para verificar qué se persiste en la bandeja.
jest.mock('../services/historialNotificaciones', () => {
  const actual = jest.requireActual('../services/historialNotificaciones');
  return { ...actual, agregarNotificacion: jest.fn(async () => []) };
});

const mockAgregar = agregarNotificacion as unknown as jest.Mock;
const mockSubscribe = subscribeToTopic as unknown as jest.Mock;

function Sonda({ cafeteriaId, activo = true }: { cafeteriaId: string | null; activo?: boolean }) {
  const { ultimaNotificacion } = useNotificacionesStock(cafeteriaId, activo);
  return <Text>{ultimaNotificacion?.titulo ?? 'nada'}</Text>;
}

function mensaje(stockActual: number, ofertaId = 'o-1'): IMessage {
  return {
    body: JSON.stringify({
      ofertaId,
      productoId: 'p-1',
      cafeteriaId: 'cafe-1',
      campusId: 'san-juan-pablo-ii',
      stockActual,
    }),
  } as IMessage;
}

// Último callback registrado por el hook (el del render más reciente).
function ultimoCallback(): (message: IMessage) => void {
  const llamadas = mockSubscribe.mock.calls;
  return llamadas[llamadas.length - 1][1];
}

async function renderizarSonda(
  cafeteriaId: string | null,
  activo = true
): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Sonda cafeteriaId={cafeteriaId} activo={activo} />);
  });
  return tree;
}

beforeEach(() => {
  mockSubscribe.mockClear();
  mockAgregar.mockClear();
});

describe('useNotificacionesStock', () => {
  it('se suscribe al topic de la cafetería al montar', async () => {
    await renderizarSonda('cafe-1');

    expect(mockSubscribe).toHaveBeenCalledWith(
      '/topic/cafeteria/cafe-1/stock',
      expect.any(Function)
    );
  });

  it('con stock 0 persiste "agotado" y lo expone en el banner', async () => {
    const tree = await renderizarSonda('cafe-1');
    const callback = ultimoCallback();

    await act(async () => {
      callback(mensaje(0));
    });

    expect(mockAgregar).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stock-agotado-o-1',
        titulo: 'Producto agotado',
        leida: false,
        url: null,
      })
    );
    expect(tree.root.findByType(Text).props.children).toBe('Producto agotado');
  });

  it('al volver el stock notifica "disponible" tras un agotado', async () => {
    const tree = await renderizarSonda('cafe-1');
    const callback = ultimoCallback();

    await act(async () => {
      callback(mensaje(0));
    });
    await act(async () => {
      callback(mensaje(3));
    });

    expect(mockAgregar).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'stock-disponible-o-1',
        titulo: 'Producto disponible',
        leida: false,
      })
    );
    expect(tree.root.findByType(Text).props.children).toBe('Producto disponible');
  });

  it('ignora eventos sin cambio de estado', async () => {
    await renderizarSonda('cafe-1');
    const callback = ultimoCallback();

    // Primer evento con stock disponible: solo línea base, no notifica.
    await act(async () => {
      callback(mensaje(5));
    });
    // Mismo estado disponible: tampoco notifica.
    await act(async () => {
      callback(mensaje(2));
    });

    expect(mockAgregar).not.toHaveBeenCalled();
  });

  it('ignora mensajes malformados', async () => {
    await renderizarSonda('cafe-1');
    const callback = ultimoCallback();

    await act(async () => {
      callback({ body: 'no-es-json' } as IMessage);
    });

    expect(mockAgregar).not.toHaveBeenCalled();
  });

  it('sin cafeteriaId no se suscribe', async () => {
    await renderizarSonda(null);

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('con activo=false no se suscribe', async () => {
    await renderizarSonda('cafe-1', false);

    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
