// src/app/(cliente)/resultado-pago.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

import ResultadoPagoScreen from './resultado-pago';
import { limpiarRouter } from '../../test-utils';
import { useLocalSearchParams } from 'expo-router';

jest.mock('expo-router', () => jest.requireActual('../../test-utils').expoRouterMock);

const mockUseLocalSearchParams = useLocalSearchParams as jest.Mock;

describe('pantalla resultado-pago', () => {
  beforeEach(() => {
    limpiarRouter();
    mockUseLocalSearchParams.mockReset();
    mockUseLocalSearchParams.mockReturnValue({} as Record<string, string>);
  });

  it('muestra resultado exitoso con datos de compra y pago', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      estado: 'exitoso',
      compraId: 'compra-123',
      paymentId: 'pago-456',
    } as Record<string, string>);

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ResultadoPagoScreen />);
    });

    const textoCompleto = JSON.stringify(tree.toJSON());
    expect(textoCompleto).toContain('Pago exitoso');
    expect(textoCompleto).toContain('compra-123');
    expect(textoCompleto).toContain('pago-456');
    expect(textoCompleto).toContain('Ver mi compra');
  });

  it('muestra resultado pendiente cuando el pago está en proceso', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      estado: 'pendiente',
      compraId: 'compra-789',
      paymentId: 'pago-000',
    } as Record<string, string>);

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ResultadoPagoScreen />);
    });

    const textoCompleto = JSON.stringify(tree.toJSON());
    expect(textoCompleto).toContain('Pago pendiente');
    expect(textoCompleto).toContain('compra-789');
    expect(textoCompleto).toContain('pago-000');
    expect(textoCompleto).toContain('Ver mis compras');
  });

  it('muestra resultado rechazado con opción para reintentar compra', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      estado: 'rechazado',
      compraId: 'compra-999',
      paymentId: 'pago-111',
    } as Record<string, string>);

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ResultadoPagoScreen />);
    });

    const textoCompleto = JSON.stringify(tree.toJSON());
    expect(textoCompleto).toContain('Pago rechazado');
    expect(textoCompleto).toContain('compra-999');
    expect(textoCompleto).toContain('pago-111');
    expect(textoCompleto).toContain('Reintentar compra');
  });

  it('muestra resultado desconocido cuando el estado no es reconocido', async () => {
    mockUseLocalSearchParams.mockReturnValue({
      estado: 'desconocido',
      compraId: 'compra-222',
      paymentId: 'pago-333',
    } as Record<string, string>);

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<ResultadoPagoScreen />);
    });

    const textoCompleto = JSON.stringify(tree.toJSON());
    expect(textoCompleto).toContain('No pudimos confirmar el estado');
    expect(textoCompleto).toContain('compra-222');
    expect(textoCompleto).toContain('pago-333');
    expect(textoCompleto).toContain('Ver mis compras');
  });
});
