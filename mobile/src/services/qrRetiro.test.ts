// src/services/qrRetiro.test.ts
import { esQrCodigoOpaco, parsearQrRetiro, serializarQrRetiro } from './qrRetiro';
import type { QrRetiro } from '../types/domain';

const CODIGO = 'b'.repeat(43);

describe('qrRetiro (contrato del QR de retiro)', () => {
  it('serializa y parsea el payload legacy del mockup (round-trip)', () => {
    const payload: QrRetiro = { pedido: 'o-1', estado: 'listo_para_retiro' };

    const contenido = serializarQrRetiro(payload);

    expect(contenido).toBe('{"pedido":"o-1","estado":"listo_para_retiro"}');
    expect(parsearQrRetiro(contenido)).toEqual(payload);
  });

  it('serializa el token del contrato dentro del payload del QR', () => {
    const contenido = serializarQrRetiro({
      pedido: 'o-1',
      estado: 'listo_para_retiro',
      codigo: CODIGO,
    });

    expect(JSON.parse(contenido)).toEqual({
      pedido: 'o-1',
      estado: 'listo_para_retiro',
      codigo: CODIGO,
    });
    expect(parsearQrRetiro(contenido)).toEqual({
      pedido: 'o-1',
      estado: 'listo_para_retiro',
      codigo: CODIGO,
    });
    // El contenido completo no es un token opaco: conserva el id para el
    // escáner, mientras `codigo` sigue siendo opaco para el backend.
    expect(esQrCodigoOpaco(contenido)).toBe(false);
  });

  it('parsea un token opaco sin inventar el id de la orden', () => {
    expect(parsearQrRetiro(CODIGO)).toEqual({
      pedido: '',
      estado: 'listo_para_retiro',
      codigo: CODIGO,
    });
  });

  it('rechaza un codigo con formato inválido dentro del JSON legacy', () => {
    expect(
      parsearQrRetiro(
        JSON.stringify({ pedido: 'o-1', estado: 'listo_para_retiro', codigo: 'corto' })
      )
    ).toBeNull();
  });

  it('acepta cualquier estado del union EstadoOrden en el payload legacy', () => {
    const casos: QrRetiro[] = [
      { pedido: 'a', estado: 'revision_requerida' },
      { pedido: 'a', estado: 'pendiente_pago' },
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

  it('rechaza contenido que no es JSON ni un token válido', () => {
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
