// src/app/(cliente)/pago/retorno.test.tsx
import { act, create } from 'react-test-renderer';

import RetornoPagoScreen from './retorno';
import { routerMock, limpiarRouter } from '../../../test-utils';
import { useLocalSearchParams } from 'expo-router';

jest.mock('expo-router', () => jest.requireActual('../../../test-utils').expoRouterMock);

const mockUseLocalSearchParams = useLocalSearchParams as jest.Mock;

describe('pantalla pago/retorno', () => {
  beforeEach(() => {
    limpiarRouter();
    mockUseLocalSearchParams.mockReset();
    mockUseLocalSearchParams.mockReturnValue({} as Record<string, string>);
  });

  it('redirige con estado exitoso cuando status=approved', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      status: 'approved',
      external_reference: 'compra-ret-1',
      payment_id: 'pay-ret-1',
    } as Record<string, string>);

    await act(async () => {
      create(<RetornoPagoScreen />);
    });

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    const llamada = routerMock.replace.mock.calls[0][0];
    expect(llamada.pathname).toBe('/resultado-pago');
    expect(llamada.params.estado).toBe('exitoso');
    expect(llamada.params.compraId).toBe('compra-ret-1');
    expect(llamada.params.paymentId).toBe('pay-ret-1');
  });

  it('redirige con estado pendiente cuando status=pending', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      status: 'pending',
      external_reference: 'compra-ret-2',
      payment_id: 'pay-ret-2',
    } as Record<string, string>);

    await act(async () => {
      create(<RetornoPagoScreen />);
    });

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    const llamada = routerMock.replace.mock.calls[0][0];
    expect(llamada.pathname).toBe('/resultado-pago');
    expect(llamada.params.estado).toBe('pendiente');
    expect(llamada.params.compraId).toBe('compra-ret-2');
    expect(llamada.params.paymentId).toBe('pay-ret-2');
  });

  it('redirige con estado rechazado cuando status=rejected', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      status: 'rejected',
      external_reference: 'compra-ret-3',
      payment_id: 'pay-ret-3',
    } as Record<string, string>);

    await act(async () => {
      create(<RetornoPagoScreen />);
    });

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    const llamada = routerMock.replace.mock.calls[0][0];
    expect(llamada.pathname).toBe('/resultado-pago');
    expect(llamada.params.estado).toBe('rechazado');
    expect(llamada.params.compraId).toBe('compra-ret-3');
    expect(llamada.params.paymentId).toBe('pay-ret-3');
  });

  it('usa collection_status y normaliza in_process a pendiente', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      collection_status: 'in_process',
      external_reference: 'compra-ret-4',
      payment_id: 'pay-ret-4',
    } as Record<string, string>);

    await act(async () => {
      create(<RetornoPagoScreen />);
    });

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    const llamada = routerMock.replace.mock.calls[0][0];
    expect(llamada.pathname).toBe('/resultado-pago');
    expect(llamada.params.estado).toBe('pendiente');
    expect(llamada.params.compraId).toBe('compra-ret-4');
    expect(llamada.params.paymentId).toBe('pay-ret-4');
  });

  it('redirige con estado desconocido cuando el status no es reconocido', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      status: 'unknown',
      external_reference: 'compra-ret-5',
      payment_id: 'pay-ret-5',
    } as Record<string, string>);

    await act(async () => {
      create(<RetornoPagoScreen />);
    });

    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    const llamada = routerMock.replace.mock.calls[0][0];
    expect(llamada.pathname).toBe('/resultado-pago');
    expect(llamada.params.estado).toBe('desconocido');
  });
});
