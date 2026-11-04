// src/__tests__/auth-activar-cuenta.test.tsx
//
// INT4-101: la pantalla de activar cuenta toma el token del enlace
// (cloudcoffee://activar-cuenta?token=...) y, como el backend todavía no
// expone un endpoint de activación, muestra un estado explícito de "servicio
// no disponible" en lugar de simular un éxito. Criterio de listo: el
// placeholder se elimina del proyecto; acá se cubre el reemplazo.
//
// El mock de expo-router devuelve el objeto de params de cada prueba
// (expo-router v57: params de tipo string | string[]) y expone el router para
// verificar la navegación de los botones.

import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';

import ActivarCuentaScreen from '../app/(auth)/activar-cuenta';
import { texto } from '../test-utils';

const mockParams: Record<string, string | string[]> = {};
const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: mockReplace, push: mockPush })),
  useLocalSearchParams: jest.fn(() => mockParams),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

async function renderizarPantalla(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ActivarCuentaScreen />);
  });
  return tree;
}

function limpiarParams(): void {
  for (const clave of Object.keys(mockParams)) {
    delete mockParams[clave];
  }
}

describe('Activar cuenta — token del enlace (INT4-101)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    limpiarParams();
  });

  it('muestra el token del enlace enmascarado y el aviso de no disponible', async () => {
    mockParams.token = 'abc123def456ghi';

    const tree = await renderizarPantalla();

    expect(texto(tree, 'activar-cuenta-token')).toBe('abc123…hi');
    expect(texto(tree, 'activar-cuenta-no-disponible')).toContain('Servicio no disponible');
    expect(
      tree.root.findAllByProps({ testID: 'activar-cuenta-token-recibido' }).length
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'activar-cuenta-sin-token' })).toHaveLength(0);
  });

  it('recorta los espacios que el enlace traiga alrededor del token', async () => {
    mockParams.token = '   abc123def456ghi   ';

    const tree = await renderizarPantalla();

    expect(texto(tree, 'activar-cuenta-token')).toBe('abc123…hi');
  });

  it('usa el primer valor si el enlace repite el parámetro', async () => {
    mockParams.token = ['abc123def456ghi', 'otro-token'];

    const tree = await renderizarPantalla();

    expect(texto(tree, 'activar-cuenta-token')).toBe('abc123…hi');
  });

  it('marca el enlace como incompleto cuando no trae token', async () => {
    const tree = await renderizarPantalla();

    expect(texto(tree, 'activar-cuenta-sin-token')).toContain('Enlace incompleto');
    expect(tree.root.findAllByProps({ testID: 'activar-cuenta-token-recibido' })).toHaveLength(0);
    expect(texto(tree, 'activar-cuenta-no-disponible')).toContain('Servicio no disponible');
  });

  it('también considera incompleto un token en blanco', async () => {
    mockParams.token = '   ';

    const tree = await renderizarPantalla();

    expect(texto(tree, 'activar-cuenta-sin-token')).toContain('Enlace incompleto');
  });

  it('lleva al login con el botón principal', async () => {
    mockParams.token = 'abc123def456ghi';

    const tree = await renderizarPantalla();
    await act(async () => {
      tree.root.findByProps({ testID: 'activar-cuenta-ir-login' }).props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('vuelve a la portada con el enlace de arriba', async () => {
    const tree = await renderizarPantalla();
    await act(async () => {
      tree.root.findByProps({ testID: 'activar-cuenta-volver' }).props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/portada');
  });
});
