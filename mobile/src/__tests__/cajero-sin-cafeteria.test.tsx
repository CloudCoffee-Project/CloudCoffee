// src/__tests__/cajero-sin-cafeteria.test.tsx
//
// Test de la pantalla del cajero sin cafetería asignada (INT4-96). Cubre los
// dos caminos del criterio de listo: cerrar sesión y avisar al administrador.

import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import * as Linking from 'expo-linking';

import SinCafeteriaAsignada from '../components/cajero/SinCafeteriaAsignada';

const mockCerrarSesion = jest.fn(async () => undefined);
const mockOpenURL = Linking.openURL as unknown as jest.Mock;

jest.mock('../context/AuthContext', () => ({
  useAuth: jest.fn(() => ({ cerrarSesion: mockCerrarSesion })),
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn(),
}));

function textoDe(nodo: ReactTestInstance): string {
  return nodo
    .findAll((hijo) => String(hijo.type) === 'Text')
    .map((hijo) => (Array.isArray(hijo.children) ? hijo.children.join('') : ''))
    .join(' ');
}

async function renderizar(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<SinCafeteriaAsignada />);
  });
  return tree;
}

describe('SinCafeteriaAsignada (INT4-96)', () => {
  beforeEach(() => {
    mockCerrarSesion.mockClear();
    mockOpenURL.mockReset();
    mockOpenURL.mockResolvedValue(true);
  });

  it('explica el caso sin dejar la pantalla vacía', async () => {
    const tree = await renderizar();

    const pantalla = tree.root.findByProps({ testID: 'cajero-sin-cafeteria' });
    const texto = textoDe(pantalla);
    expect(texto).toContain('Sin cafetería asignada');
    expect(texto).toContain('no tiene una cafetería asignada');

    act(() => tree.unmount());
  });

  it('cierra la sesión al tocar la acción principal', async () => {
    const tree = await renderizar();

    const boton = tree.root.findByProps({ testID: 'cajero-sin-cafeteria-cerrar-sesion' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(mockCerrarSesion).toHaveBeenCalledTimes(1);

    act(() => tree.unmount());
  });

  it('avisa al administrador abriendo el correo pre-redactado', async () => {
    const tree = await renderizar();

    const boton = tree.root.findByProps({ testID: 'cajero-sin-cafeteria-avisar-admin' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(String(mockOpenURL.mock.calls[0][0]).startsWith('mailto:')).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'cajero-sin-cafeteria-aviso-error' })).toHaveLength(
      0
    );

    act(() => tree.unmount());
  });

  it('muestra el correo del administrador si no se puede abrir la app de correo', async () => {
    mockOpenURL.mockResolvedValue(false);
    const tree = await renderizar();

    const boton = tree.root.findByProps({ testID: 'cajero-sin-cafeteria-avisar-admin' });
    await act(async () => {
      boton.props.onPress();
    });

    const aviso = tree.root.findByProps({ testID: 'cajero-sin-cafeteria-aviso-error' });
    expect(textoDe(aviso)).toContain('administrador@cloudcoffee.dev');

    act(() => tree.unmount());
  });
});
