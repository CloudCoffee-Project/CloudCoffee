// src/hooks/int4-137-envelope-aceptacion.test.tsx
// Aceptación del punto "leer desde payload": los hooks ignoran el formato
// plano viejo y solo reaccionan al envelope CloudCoffeeEvent.

import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import type { IMessage } from '@stomp/stompjs';

import { useCafeteriaStock } from './useCafeteriaStock';
import { useOrdenEstado } from './useOrdenEstado';
import { subscribeToTopic } from '../services/websocket';

jest.mock('../services/websocket', () => ({
  topicOrdenEstado: jest.fn((id: string) => `/topic/orden/${id}/estado`),
  topicCafeteriaStock: jest.fn((id: string) => `/topic/cafeteria/${id}/stock`),
  subscribeToTopic: jest.fn(() => () => {}),
}));

const mockSubscribe = subscribeToTopic as unknown as jest.Mock;

function SondaOrden({ ordenId }: { ordenId: string }) {
  const estado = useOrdenEstado(ordenId);
  return <Text>{estado ?? 'sin-estado'}</Text>;
}

function SondaStock({ cafeteriaId }: { cafeteriaId: string }) {
  const stock = useCafeteriaStock(cafeteriaId);
  return <Text>{stock['o-1'] === undefined ? 'sin-stock' : `${stock['o-1']}`}</Text>;
}

function mensaje(body: unknown): IMessage {
  return { body: JSON.stringify(body) } as IMessage;
}

function ultimoCallback(): (message: IMessage) => void {
  const llamadas = mockSubscribe.mock.calls;
  return llamadas[llamadas.length - 1][1];
}

function textoDe(tree: ReactTestRenderer): string {
  return tree.root.findByType(Text).props.children as string;
}

beforeEach(() => {
  mockSubscribe.mockClear();
});

describe('INT4-137 · aceptación (envelope payload en hooks)', () => {
  it('useOrdenEstado lee payload.estado e ignora el campo plano', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SondaOrden ordenId="orden-1" />);
    });

    expect(mockSubscribe).toHaveBeenCalledWith('/topic/orden/orden-1/estado', expect.any(Function));
    const callback = ultimoCallback();

    await act(async () => {
      callback(mensaje({ estado: 'entregado' }));
    });
    expect(textoDe(tree)).toBe('sin-estado');

    await act(async () => {
      callback(
        mensaje({
          eventId: 'e-1',
          eventType: 'orden.estado.actualizado.v1',
          payload: { ordenId: 'orden-1', estado: 'listo_para_retiro' },
        })
      );
    });
    expect(textoDe(tree)).toBe('listo_para_retiro');
  });

  it('useCafeteriaStock lee payload.ofertaId/stockActual e ignora campos planos', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<SondaStock cafeteriaId="cafe-1" />);
    });

    expect(mockSubscribe).toHaveBeenCalledWith(
      '/topic/cafeteria/cafe-1/stock',
      expect.any(Function)
    );
    const callback = ultimoCallback();

    await act(async () => {
      callback(mensaje({ ofertaId: 'o-1', stockActual: 0 }));
    });
    expect(textoDe(tree)).toBe('sin-stock');

    await act(async () => {
      callback(
        mensaje({
          eventId: 'e-2',
          eventType: 'catalog.stock.actualizado.v1',
          payload: { ofertaId: 'o-1', stockActual: 3 },
        })
      );
    });
    expect(textoDe(tree)).toBe('3');
  });
});
