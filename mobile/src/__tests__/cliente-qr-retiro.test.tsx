// src/__tests__/cliente-qr-retiro.test.tsx
// Cubre el enlace "Ver Boleta en PDF" (INT4-48): el Código de Retiro navega al
// detalle de la orden con el id y estado correctos para descargar la boleta.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import QrRetiroScreen from '../app/(cliente)/qr-retiro';
import { useLocalSearchParams } from 'expo-router';

jest.mock('react-native-qrcode-svg', () => 'QRCode');

const mockRouter = { back: jest.fn(), push: jest.fn() };

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({ id: 'orden-1', estado: 'listo_para_retiro' })),
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

beforeEach(() => {
  mockRouter.back.mockClear();
  mockRouter.push.mockClear();
  mockUseLocalSearchParams.mockReturnValue({ id: 'orden-1', estado: 'listo_para_retiro' });
});

describe('pantalla de Código de Retiro (enlace a boleta)', () => {
  it('ofrece ver la boleta en PDF del pedido mostrado', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<QrRetiroScreen />);
    });

    const boton = tree.root.findByProps({ testID: 'abrir-boleta' });
    expect(textoDe(boton)).toContain('Ver Boleta en PDF');

    act(() => tree.unmount());
  });

  it('navega al detalle de la orden con el id y estado actuales', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<QrRetiroScreen />);
    });

    const boton = tree.root.findByProps({ testID: 'abrir-boleta' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/orden/[id]',
      params: { id: 'orden-1', estado: 'listo_para_retiro' },
    });

    act(() => tree.unmount());
  });

  it('no muestra el botón de boleta si no hay id de orden', async () => {
    mockUseLocalSearchParams.mockReturnValue({});

    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<QrRetiroScreen />);
    });

    expect(tree.root.findAllByProps({ testID: 'abrir-boleta' })).toHaveLength(0);
    expect(mockRouter.push).not.toHaveBeenCalled();

    act(() => tree.unmount());
  });
});
