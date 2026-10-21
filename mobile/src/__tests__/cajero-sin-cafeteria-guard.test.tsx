// src/__tests__/cajero-sin-cafeteria-guard.test.tsx
//
// Guard de navegación del cajero sin cafetería (INT4-96): cuando la sesión es de
// un cajero sin cafeteriaId, el root layout muestra la pantalla "Sin cafetería
// asignada" en vez de montar el grupo (cajero). Se prueba sobre el RootLayout
// mockeando solo lo que depende de nativo (WebSocket, push, stock, router).

import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

import RootLayout from '../app/_layout';

jest.mock('expo-router', () => ({
  Slot: () => null,
  useRouter: jest.fn(() => ({ replace: jest.fn(), push: jest.fn() })),
  useSegments: jest.fn(() => ['(cajero)']),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUseAuth = jest.fn();
jest.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../context/CarritoContext', () => ({
  CarritoProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../hooks/useNotificacionesPush', () => ({
  useNotificacionesPush: () => ({ estado: { mensaje: null }, ultimaNotificacion: null }),
}));

jest.mock('../hooks/useNotificacionesStock', () => ({
  useNotificacionesStock: () => ({ ultimaNotificacion: null }),
}));

jest.mock('../hooks/useCafeteriaActual', () => ({
  useCafeteriaActual: () => null,
}));

jest.mock('../services/websocket', () => ({
  connectWebSocket: jest.fn(),
  disconnectWebSocket: jest.fn(),
}));

// El banner no es parte de este comportamiento; se neutraliza para no arrastrar
// sus dependencias nativas.
jest.mock('../components/BannerNotificacionPush', () => () => null);

async function renderizarRoot(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<RootLayout />);
  });
  return tree;
}

describe('RootNavigator — cajero sin cafetería (INT4-96)', () => {
  it('muestra la pantalla sin cafetería y no las pestañas del POS', async () => {
    mockUseAuth.mockReturnValue({
      sesion: { userId: 'u-1', rol: 'cajero', cafeteriaId: null, exp: 0 },
      bootstrapping: false,
      iniciarSesion: jest.fn(),
      cerrarSesion: jest.fn(),
    });

    const tree = await renderizarRoot();

    expect(tree.root.findAllByProps({ testID: 'cajero-sin-cafeteria' }).length).toBeGreaterThan(0);

    act(() => tree.unmount());
  });

  it('con cafetería asignada no corta la navegación normal', async () => {
    mockUseAuth.mockReturnValue({
      sesion: { userId: 'u-1', rol: 'cajero', cafeteriaId: 'c-1', exp: 0 },
      bootstrapping: false,
      iniciarSesion: jest.fn(),
      cerrarSesion: jest.fn(),
    });

    const tree = await renderizarRoot();

    expect(tree.root.findAllByProps({ testID: 'cajero-sin-cafeteria' })).toHaveLength(0);

    act(() => tree.unmount());
  });
});
