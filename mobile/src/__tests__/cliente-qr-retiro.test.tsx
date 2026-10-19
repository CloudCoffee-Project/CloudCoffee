// src/__tests__/cliente-qr-retiro.test.tsx
// Cubre el enlace "Ver Boleta en PDF" (INT4-48): el Código de Retiro navega al
// detalle de la orden con el id y estado correctos para descargar la boleta.
import { useLocalSearchParams } from 'expo-router';

import QrRetiroScreen from '../app/(cliente)/qr-retiro';
import { desmontar, limpiarRouter, pulsar, renderizar, routerMock, texto } from '../test-utils';

jest.mock('react-native-qrcode-svg', () => 'QRCode');

jest.mock('expo-router', () => jest.requireActual('../test-utils').expoRouterMock);

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('../test-utils').safeAreaContextMock
);

const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;

const PARAMS = { id: 'orden-1', estado: 'listo_para_retiro' };

beforeEach(() => {
  limpiarRouter();
  mockUseLocalSearchParams.mockReturnValue(PARAMS);
});

describe('pantalla de Código de Retiro (enlace a boleta)', () => {
  it('ofrece ver la boleta en PDF del pedido mostrado', async () => {
    const tree = await renderizar(<QrRetiroScreen />);

    expect(texto(tree, 'abrir-boleta')).toContain('Ver Boleta en PDF');

    desmontar(tree);
  });

  it('navega al detalle de la orden con el id y estado actuales', async () => {
    const tree = await renderizar(<QrRetiroScreen />);

    await pulsar(tree, 'abrir-boleta');

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/orden/[id]',
      params: { id: 'orden-1', estado: 'listo_para_retiro' },
    });

    desmontar(tree);
  });

  it('no muestra el botón de boleta si no hay id de orden', async () => {
    mockUseLocalSearchParams.mockReturnValue({});

    const tree = await renderizar(<QrRetiroScreen />);

    expect(tree.root.findAllByProps({ testID: 'abrir-boleta' })).toHaveLength(0);
    expect(routerMock.push).not.toHaveBeenCalled();

    desmontar(tree);
  });
});
