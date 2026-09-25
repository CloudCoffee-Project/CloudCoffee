// src/services/notificacionesStock.test.ts
import { estadoDeStock, notificacionDeEventoStock, transicionDeStock } from './notificacionesStock';
import type { StockCafeteriaEvento } from '../types/domain';

function evento(stockActual: number, ofertaId = 'o-1'): StockCafeteriaEvento {
  return {
    ofertaId,
    productoId: 'p-1',
    cafeteriaId: 'cafe-1',
    campusId: 'san-juan-pablo-ii',
    stockActual,
  };
}

describe('estadoDeStock', () => {
  it('considera agotado el stock <= 0 y disponible el stock > 0', () => {
    expect(estadoDeStock(0)).toBe('agotado');
    expect(estadoDeStock(-2)).toBe('agotado');
    expect(estadoDeStock(1)).toBe('disponible');
    expect(estadoDeStock(5)).toBe('disponible');
  });
});

describe('transicionDeStock', () => {
  it('notifica agotado cuando el stock llega a 0', () => {
    expect(transicionDeStock(3, 0)).toBe('agotado');
  });

  it('notifica disponible cuando el stock vuelve a ser > 0', () => {
    expect(transicionDeStock(0, 2)).toBe('disponible');
  });

  it('no notifica cuando el estado no cambia', () => {
    expect(transicionDeStock(4, 2)).toBeNull();
    expect(transicionDeStock(0, 0)).toBeNull();
    expect(transicionDeStock(-1, 0)).toBeNull();
  });

  it('con el primer evento disponible solo fija la línea base', () => {
    expect(transicionDeStock(null, 5)).toBeNull();
    expect(transicionDeStock(undefined, 5)).toBeNull();
  });

  it('con el primer evento agotado sí notifica', () => {
    expect(transicionDeStock(null, 0)).toBe('agotado');
  });
});

describe('notificacionDeEventoStock', () => {
  it('construye la entrada de agotado', () => {
    const entrada = notificacionDeEventoStock(evento(0), 'agotado');
    expect(entrada).toEqual(
      expect.objectContaining({
        id: 'stock-agotado-o-1',
        titulo: 'Producto agotado',
        leida: false,
        url: null,
      })
    );
    expect(entrada.cuerpo).toContain('sin stock');
  });

  it('construye la entrada de disponible', () => {
    const entrada = notificacionDeEventoStock(evento(3), 'disponible');
    expect(entrada).toEqual(
      expect.objectContaining({
        id: 'stock-disponible-o-1',
        titulo: 'Producto disponible',
        leida: false,
        url: null,
      })
    );
    expect(entrada.cuerpo).toContain('disponible');
  });
});
