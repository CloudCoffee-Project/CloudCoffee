// src/services/pagos.test.ts
import * as Linking from 'expo-linking';

import { parsearRetornoPago } from './pagos';

jest.mock('expo-linking');

const mockedLinking = Linking as jest.Mocked<typeof Linking>;

describe('servicio de pagos - parsearRetornoPago', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lee el retorno con status=approved y lo mapea a estado exitoso', () => {
    mockedLinking.parse.mockReturnValue({
      queryParams: {
        status: 'approved',
        payment_id: 'pay_123',
        external_reference: 'compra_abc',
        preference_id: 'pref_456',
        merchant_order_id: 'mo_789',
      },
    } as any);

    const resultado = parsearRetornoPago(
      'cloudcoffee://pago/retorno?status=approved&payment_id=pay_123&external_reference=compra_abc&preference_id=pref_456&merchant_order_id=mo_789'
    );

    expect(mockedLinking.parse).toHaveBeenCalledTimes(1);
    expect(resultado.estado).toBe('exitoso');
    expect(resultado.paymentId).toBe('pay_123');
    expect(resultado.compraId).toBe('compra_abc');
    expect(resultado.preferenceId).toBe('pref_456');
    expect(resultado.merchantOrderId).toBe('mo_789');
  });

  it('lee el retorno con status=pending y lo mapea a estado pendiente', () => {
    mockedLinking.parse.mockReturnValue({
      queryParams: {
        status: 'pending',
        external_reference: 'compra_pending',
        payment_id: 'pay_pending',
      },
    } as any);

    const resultado = parsearRetornoPago(
      'cloudcoffee://pago/retorno?status=pending&external_reference=compra_pending&payment_id=pay_pending'
    );

    expect(resultado.estado).toBe('pendiente');
    expect(resultado.compraId).toBe('compra_pending');
    expect(resultado.paymentId).toBe('pay_pending');
  });

  it('lee el retorno con status=rejected y lo mapea a estado rechazado', () => {
    mockedLinking.parse.mockReturnValue({
      queryParams: {
        status: 'rejected',
        collection_id: 'col_999',
        external_reference: 'compra_rechazada',
      },
    } as any);

    const resultado = parsearRetornoPago(
      'cloudcoffee://pago/retorno?status=rejected&collection_id=col_999&external_reference=compra_rechazada'
    );

    expect(resultado.estado).toBe('rechazado');
    expect(resultado.paymentId).toBe('col_999');
    expect(resultado.compraId).toBe('compra_rechazada');
  });

  it('usa collection_status cuando status no viene (aprobado/pendiente/rechazado)', () => {
    mockedLinking.parse.mockReturnValueOnce({
      queryParams: { collection_status: 'approved' },
    } as any);

    expect(parsearRetornoPago('cloudcoffee://pago/retorno?collection_status=approved').estado).toBe(
      'exitoso'
    );

    mockedLinking.parse.mockReturnValueOnce({
      queryParams: { collection_status: 'pending' },
    } as any);

    expect(parsearRetornoPago('cloudcoffee://pago/retorno?collection_status=pending').estado).toBe(
      'pendiente'
    );

    mockedLinking.parse.mockReturnValueOnce({
      queryParams: { collection_status: 'in_process' },
    } as any);

    expect(
      parsearRetornoPago('cloudcoffee://pago/retorno?collection_status=in_process').estado
    ).toBe('pendiente');

    mockedLinking.parse.mockReturnValueOnce({
      queryParams: { collection_status: 'rejected' },
    } as any);

    expect(parsearRetornoPago('cloudcoffee://pago/retorno?collection_status=rejected').estado).toBe(
      'rechazado'
    );
  });

  it('mapea in_process desde status a pendiente', () => {
    mockedLinking.parse.mockReturnValue({
      queryParams: { status: 'in_process' },
    } as any);

    const resultado = parsearRetornoPago('cloudcoffee://pago/retorno?status=in_process');

    expect(resultado.estado).toBe('pendiente');
  });

  it('devuelve desconocido cuando el estado no es reconocido', () => {
    mockedLinking.parse.mockReturnValue({
      queryParams: { status: 'unknown_state' },
    } as any);

    const resultado = parsearRetornoPago('cloudcoffee://pago/retorno?status=unknown_state');

    expect(resultado.estado).toBe('desconocido');
  });

  it('prioriza status sobre collection_status al normalizar', () => {
    mockedLinking.parse.mockReturnValue({
      queryParams: { status: 'rejected', collection_status: 'approved' },
    } as any);

    const resultado = parsearRetornoPago(
      'cloudcoffee://pago/retorno?status=rejected&collection_status=approved'
    );

    expect(resultado.estado).toBe('rechazado');
  });

  it('lee paymentId desde collection_id cuando payment_id no viene', () => {
    mockedLinking.parse.mockReturnValue({
      queryParams: { status: 'approved', collection_id: 'col_777' },
    } as any);

    const resultado = parsearRetornoPago(
      'cloudcoffee://pago/retorno?status=approved&collection_id=col_777'
    );

    expect(resultado.estado).toBe('exitoso');
    expect(resultado.paymentId).toBe('col_777');
  });
});
