// src/services/qrRetiro.test.ts
import { parsearQrRetiro, serializarQrRetiro } from './qrRetiro';
import type { QrRetiro } from '../types/domain';

describe('qrRetiro (contrato del QR de retiro)', () => {
  it('serializa y parsea un payload válido (round-trip)', () => {
    const payload: QrRetiro = { pedido: 'o-1', estado: 'listo_para_retiro' };

    const contenido = serializarQrRetiro(payload);

    expect(contenido).toBe('{"pedido":"o-1","estado":"listo_para_retiro"}');
    expect(parsearQrRetiro(contenido)).toEqual(payload);
  });

  it('acepta cualquier estado del union EstadoOrden', () => {
    const casos: QrRetiro[] = [
      { pedido: 'a', estado: 'reservando' },
      { pedido: 'a', estado: 'pagado' },
      { pedido: 'a', estado: 'listo_para_retiro' },
      { pedido: 'a', estado: 'no_retirado_pendiente_revision' },
      { pedido: 'a', estado: 'entregado' },
      { pedido: 'a', estado: 'no_retirado_final' },
      { pedido: 'a', estado: 'cancelado' },
    ];

    casos.forEach((payload) => {
      expect(parsearQrRetiro(serializarQrRetiro(payload))).toEqual(payload);
    });
  });

  it('rechaza contenido que no es JSON', () => {
    expect(parsearQrRetiro('no-es-json')).toBeNull();
    expect(parsearQrRetiro('')).toBeNull();
  });

  it('rechaza JSON que no es un objeto', () => {
    expect(parsearQrRetiro('["o-1","listo_para_retiro"]')).toBeNull();
    expect(parsearQrRetiro('null')).toBeNull();
    expect(parsearQrRetiro('42')).toBeNull();
  });

  it('rechaza payload sin pedido o con pedido vacío', () => {
    expect(parsearQrRetiro('{"estado":"pagado"}')).toBeNull();
    expect(parsearQrRetiro('{"pedido":"","estado":"pagado"}')).toBeNull();
    expect(parsearQrRetiro('{"pedido":123,"estado":"pagado"}')).toBeNull();
  });

  it('rechaza un estado que no existe en el union EstadoOrden', () => {
    expect(parsearQrRetiro('{"pedido":"o-1","estado":"listo"}')).toBeNull();
    expect(parsearQrRetiro('{"pedido":"o-1","estado":"NO_RETIRADO"}')).toBeNull();
    expect(parsearQrRetiro('{"pedido":"o-1","estado":42}')).toBeNull();
  });
});
