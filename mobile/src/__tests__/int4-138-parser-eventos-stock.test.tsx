// src/__tests__/int4-138-parser-eventos-stock.test.tsx
//
// INT4-138 · Parser de eventos de stock del topic
// /topic/cafeteria/{cafeteriaId}/stock.
//
// El parser acepta el payload plano de `main` (StockCafeteriaEvento) y el
// envelope CloudCoffeeEvent de INT4-137. Estas pruebas cubren ambos formatos,
// la clasificación agotado/disponible, la línea base del primer evento y que
// un mensaje malformado no rompe la pantalla.

import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import type { IMessage } from '@stomp/stompjs';
import { useFocusEffect } from 'expo-router';

import StockScreen from '../app/(cajero)/stock';
import { useCafeteriaStock } from '../hooks/useCafeteriaStock';
import { useNotificacionesStock } from '../hooks/useNotificacionesStock';
import { agregarNotificacion } from '../services/historialNotificaciones';
import { listarInventarioCafeteria, obtenerNombreCafeteria } from '../services/inventario';
import { subscribeToTopic } from '../services/websocket';
import { desmontar, textoDe } from '../test-utils';
import type { InventarioItem } from '../types/domain';

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);
jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);
jest.mock('expo-notifications', () => ({}));

// La suscripción se mockea para disparar a mano el callback con mensajes
// STOMP, como haría el gateway.
jest.mock('../services/websocket', () => ({
  topicCafeteriaStock: jest.fn((id: string) => `/topic/cafeteria/${id}/stock`),
  subscribeToTopic: jest.fn(() => () => {}),
}));

// Se espía el sumidero de la bandeja sin ejecutar AsyncStorage real.
jest.mock('../services/historialNotificaciones', () => {
  const actual = jest.requireActual('../services/historialNotificaciones');
  return { ...actual, agregarNotificacion: jest.fn(async () => []) };
});

jest.mock('../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    sesion: {
      userId: 'user-1',
      rol: 'cajero',
      cafeteriaId: 'cafe-1',
      exp: 0,
    },
    bootstrapping: false,
    iniciarSesion: jest.fn(),
    cerrarSesion: jest.fn(),
  })),
}));

jest.mock('../services/inventario', () => ({
  listarInventarioCafeteria: jest.fn(),
  obtenerNombreCafeteria: jest.fn(),
}));

const mockSubscribe = subscribeToTopic as unknown as jest.Mock;
const mockAgregar = agregarNotificacion as unknown as jest.Mock;
const mockListar = listarInventarioCafeteria as unknown as jest.Mock;
const mockNombre = obtenerNombreCafeteria as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;

const inventarioMock: InventarioItem[] = [
  {
    ofertaId: 'of-1',
    productoId: 'prod-1',
    productoNombre: 'Café americano',
    precio: 1500,
    stock: 40,
    estado: 'AVAILABLE',
  },
  {
    ofertaId: 'of-2',
    productoId: 'prod-2',
    productoNombre: 'Latte de vainilla',
    precio: 2600,
    stock: 0,
    estado: 'OUT_OF_STOCK',
  },
];

let arbolActual: ReactTestRenderer | null = null;

function mensaje(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

function mensajeCrudo(body: string): IMessage {
  return { body } as IMessage;
}

// Payload plano vigente en main (StockCafeteriaEvento).
function evento(stockActual: number, ofertaId = 'o-1'): Record<string, unknown> {
  return {
    ofertaId,
    productoId: 'p-1',
    cafeteriaId: 'cafe-1',
    campusId: 'san-juan-pablo-ii',
    stockActual,
  };
}

/** Último callback registrado por los hooks (el del render más reciente). */
function ultimoCallback(): (message: IMessage) => void {
  const llamadas = mockSubscribe.mock.calls;
  return llamadas[llamadas.length - 1][1];
}

function SondaStock() {
  const stock = useCafeteriaStock('cafe-1');
  const entradas = Object.entries(stock).map(([ofertaId, cantidad]) => `${ofertaId}:${cantidad}`);
  return <Text>{entradas.length > 0 ? entradas.join(',') : 'sin-stock'}</Text>;
}

function SondaNotificaciones() {
  const { ultimaNotificacion } = useNotificacionesStock('cafe-1');
  return <Text>{ultimaNotificacion?.titulo ?? 'nada'}</Text>;
}

function textoDeSonda(tree: ReactTestRenderer): string {
  return tree.root.findByType(Text).props.children as string;
}

async function renderizarSonda(componente: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(componente);
  });
  arbolActual = tree;
  return tree;
}

// Monta la pantalla real (con useCafeteriaStock real) y dispara el foco para
// cargar el inventario de fondo.
async function renderizarPantalla(): Promise<ReactTestRenderer> {
  const tree = await renderizarSonda(<StockScreen />);
  const llamadas = mockUseFocusEffect.mock.calls;
  const alGanarFoco = llamadas[llamadas.length - 1][0] as () => void;
  await act(async () => {
    alGanarFoco();
  });
  return tree;
}

function datosDe(tree: ReactTestRenderer): InventarioItem[] {
  return tree.root.findByType(FlatList).props.data as InventarioItem[];
}

beforeEach(() => {
  mockSubscribe.mockClear();
  mockAgregar.mockClear();
  mockUseFocusEffect.mockReset();
  mockListar.mockReset();
  mockNombre.mockReset();
  mockListar.mockResolvedValue(inventarioMock);
  mockNombre.mockResolvedValue('Cafetería Central');
});

afterEach(() => {
  if (arbolActual !== null) {
    desmontar(arbolActual);
    arbolActual = null;
  }
});

describe('INT4-138 · parser de eventos de stock', () => {
  describe('payload del mensaje (envelope)', () => {
    it('lee ofertaId y stockActual del payload del body', async () => {
      const tree = await renderizarSonda(<SondaStock />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(4, 'o-7')));
      });

      expect(textoDeSonda(tree)).toBe('o-7:4');
    });

    it('solo consume los campos del payload e ignora metadatos extra', async () => {
      const tree = await renderizarSonda(<SondaStock />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(
          mensaje({
            ...evento(2),
            eventId: 'e-1',
            eventType: 'catalog.stock.actualizado.v1',
            cafeteriaId: 'otra-cafeteria',
          })
        );
      });

      expect(textoDeSonda(tree)).toBe('o-1:2');
    });

    it('lee el payload de un envelope CloudCoffeeEvent', async () => {
      // El contrato de INT4-137 (eventId/eventType/payload) se acepta aunque
      // ese branch todavía no esté fusionado en main.
      const tree = await renderizarSonda(<SondaStock />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(
          mensaje({
            eventId: 'e-1',
            eventType: 'catalog.stock.actualizado.v1',
            payload: evento(3),
          })
        );
      });

      expect(textoDeSonda(tree)).toBe('o-1:3');
    });
  });

  describe('detección de agotado y disponible', () => {
    it('stock 0 se detecta como agotado', async () => {
      const tree = await renderizarSonda(<SondaNotificaciones />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(0)));
      });

      expect(mockAgregar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stock-agotado-o-1', titulo: 'Producto agotado' })
      );
      expect(textoDeSonda(tree)).toBe('Producto agotado');
    });

    it('stock > 0 se detecta como disponible tras un agotado', async () => {
      const tree = await renderizarSonda(<SondaNotificaciones />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(0)));
      });
      await act(async () => {
        callback(mensaje(evento(3)));
      });

      expect(mockAgregar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stock-disponible-o-1', titulo: 'Producto disponible' })
      );
      expect(textoDeSonda(tree)).toBe('Producto disponible');
    });

    it('la pantalla refleja el cambio de agotado a disponible del evento', async () => {
      const tree = await renderizarPantalla();
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(5, 'of-2')));
      });

      expect(datosDe(tree)[1].stock).toBe(5);
      expect(datosDe(tree)[1].estado).toBe('AVAILABLE');
      expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-badge-of-2' }))).toBe('5 un.');
      expect(textoDe(tree.root.findByProps({ testID: 'cajero-stock-chip-agotados' }))).toBe(
        'Agotados (0)'
      );
    });
  });

  describe('primer evento como línea base', () => {
    it('el primer evento disponible solo fija la línea base y no notifica', async () => {
      const tree = await renderizarSonda(<SondaNotificaciones />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(5)));
      });
      await act(async () => {
        callback(mensaje(evento(2)));
      });

      expect(mockAgregar).not.toHaveBeenCalled();
      expect(textoDeSonda(tree)).toBe('nada');
    });

    it('notifica agotado cuando la línea base disponible llega a 0', async () => {
      const tree = await renderizarSonda(<SondaNotificaciones />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(5)));
      });
      await act(async () => {
        callback(mensaje(evento(2)));
      });
      await act(async () => {
        callback(mensaje(evento(0)));
      });

      expect(mockAgregar).toHaveBeenCalledTimes(1);
      expect(mockAgregar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'stock-agotado-o-1' })
      );
      expect(textoDeSonda(tree)).toBe('Producto agotado');
    });

    it('el primer evento agotado sí notifica', async () => {
      const tree = await renderizarSonda(<SondaNotificaciones />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(0)));
      });

      expect(mockAgregar).toHaveBeenCalledTimes(1);
      expect(textoDeSonda(tree)).toBe('Producto agotado');
    });
  });

  describe('mensaje malformado que no rompe la pantalla', () => {
    it('un JSON inválido no altera el stock y el siguiente evento sí se procesa', async () => {
      const tree = await renderizarSonda(<SondaStock />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(evento(4)));
      });
      await act(async () => {
        callback(mensajeCrudo('no-es-json'));
      });
      expect(textoDeSonda(tree)).toBe('o-1:4');

      await act(async () => {
        callback(mensaje(evento(7)));
      });
      expect(textoDeSonda(tree)).toBe('o-1:7');
    });

    it('payloads estructuralmente inválidos no lanzan ni frenan el flujo', async () => {
      const tree = await renderizarSonda(<SondaStock />);
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensaje(null));
        callback(mensaje('texto'));
        callback(mensaje([]));
        callback(mensaje({}));
        callback(mensaje({ ofertaId: 'o-1' }));
        callback(mensaje({ stockActual: 3 }));
      });

      await act(async () => {
        callback(mensaje(evento(1, 'o-2')));
      });
      expect(textoDeSonda(tree)).toContain('o-2:1');
    });

    it('la pantalla sigue mostrando el inventario tras mensajes malformados', async () => {
      const tree = await renderizarPantalla();
      const callback = ultimoCallback();

      await act(async () => {
        callback(mensajeCrudo('{'));
        callback(mensaje(null));
        callback(mensaje({}));
      });

      expect(datosDe(tree)).toEqual(inventarioMock);
      expect(textoDe(tree.root)).toContain('Stock · Cafetería Central');
    });
  });
});
