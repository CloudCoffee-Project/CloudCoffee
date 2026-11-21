// src/services/parsearEventoStock.test.ts
import { estadoDeStock, transicionDeStock } from './notificacionesStock';
import { parsearEventoStock } from './parsearEventoStock';

function body(stockActual: number, ofertaId = 'o-1'): string {
  return JSON.stringify({
    ofertaId,
    productoId: 'p-1',
    cafeteriaId: 'cafe-1',
    campusId: 'san-juan-pablo-ii',
    stockActual,
  });
}

describe('parsearEventoStock', () => {
  describe('payload del mensaje (envelope)', () => {
    it('parsea el payload plano del body del evento de stock', () => {
      expect(parsearEventoStock(body(3))).toEqual({
        ofertaId: 'o-1',
        productoId: 'p-1',
        cafeteriaId: 'cafe-1',
        campusId: 'san-juan-pablo-ii',
        stockActual: 3,
      });
    });

    it('acepta un payload con solo los campos que consume el parser', () => {
      expect(parsearEventoStock(JSON.stringify({ ofertaId: 'o-9', stockActual: 1 }))).toEqual({
        ofertaId: 'o-9',
        productoId: '',
        cafeteriaId: '',
        campusId: '',
        stockActual: 1,
      });
    });

    it('lee ofertaId y stockActual del payload de un envelope CloudCoffeeEvent', () => {
      // Contrato de INT4-137: eventId/eventType + payload con el evento de stock.
      expect(
        parsearEventoStock(
          JSON.stringify({
            eventId: 'e-1',
            eventType: 'catalog.stock.actualizado.v1',
            payload: {
              ofertaId: 'o-4',
              productoId: 'p-4',
              cafeteriaId: 'cafe-1',
              campusId: 'san-juan-pablo-ii',
              stockActual: 6,
            },
          })
        )
      ).toEqual({
        ofertaId: 'o-4',
        productoId: 'p-4',
        cafeteriaId: 'cafe-1',
        campusId: 'san-juan-pablo-ii',
        stockActual: 6,
      });
    });

    it('da prioridad al payload del envelope sobre campos planos duplicados', () => {
      expect(
        parsearEventoStock(
          JSON.stringify({
            ofertaId: 'o-plano',
            stockActual: 99,
            eventId: 'e-2',
            eventType: 'catalog.stock.actualizado.v1',
            payload: { ofertaId: 'o-envelope', stockActual: 2 },
          })
        )
      ).toEqual({
        ofertaId: 'o-envelope',
        productoId: '',
        cafeteriaId: '',
        campusId: '',
        stockActual: 2,
      });
    });
  });

  describe('detección de agotado y disponible', () => {
    it('clasifica agotado el stock 0 y negativo del payload parseado', () => {
      expect(estadoDeStock(parsearEventoStock(body(0))!.stockActual)).toBe('agotado');
      expect(estadoDeStock(parsearEventoStock(body(-2))!.stockActual)).toBe('agotado');
    });

    it('clasifica disponible el stock positivo del payload parseado', () => {
      expect(estadoDeStock(parsearEventoStock(body(1))!.stockActual)).toBe('disponible');
      expect(estadoDeStock(parsearEventoStock(body(5))!.stockActual)).toBe('disponible');
    });

    it('detecta la transición de agotado a disponible entre dos eventos', () => {
      const agotado = parsearEventoStock(body(0))!;
      const disponible = parsearEventoStock(body(2))!;

      expect(transicionDeStock(agotado.stockActual, disponible.stockActual)).toBe('disponible');
    });
  });

  describe('primer evento como línea base', () => {
    it('el primer evento disponible solo fija la línea base', () => {
      const primero = parsearEventoStock(body(5))!;

      expect(transicionDeStock(null, primero.stockActual)).toBeNull();
    });

    it('el primer evento agotado sí se notifica', () => {
      const primero = parsearEventoStock(body(0))!;

      expect(transicionDeStock(null, primero.stockActual)).toBe('agotado');
    });
  });

  describe('mensaje malformado', () => {
    it.each([
      ['JSON inválido', 'no-es-json'],
      ['body vacío', ''],
      ['null', 'null'],
      ['array', '[]'],
      ['número', '7'],
      ['texto', '"texto"'],
    ])('devuelve null para %s sin lanzar', (_caso, crudo) => {
      expect(parsearEventoStock(crudo)).toBeNull();
    });

    it.each([
      ['ofertaId ausente', { stockActual: 3 }],
      ['ofertaId vacío', { ofertaId: '', stockActual: 3 }],
      ['ofertaId no string', { ofertaId: 1, stockActual: 3 }],
      ['stockActual ausente', { ofertaId: 'o-1' }],
      ['stockActual como string', { ofertaId: 'o-1', stockActual: '3' }],
      ['stockActual null', { ofertaId: 'o-1', stockActual: null }],
    ])('devuelve null para %s', (_caso, payload) => {
      expect(parsearEventoStock(JSON.stringify(payload))).toBeNull();
    });

    it('devuelve null para valores numéricos no finitos', () => {
      expect(parsearEventoStock('{"ofertaId":"o-1","stockActual":null}')).toBeNull();
      expect(parsearEventoStock('{"ofertaId":"o-1","stockActual":1e400}')).toBeNull();
    });

    it('no lanza aunque el body no sea un string', () => {
      expect(parsearEventoStock(undefined as unknown as string)).toBeNull();
    });
  });
});
