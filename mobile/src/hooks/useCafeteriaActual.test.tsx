// src/hooks/useCafeteriaActual.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useCafeteriaActual } from './useCafeteriaActual';
import type { Rol } from '../types/domain';

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
  getAllKeys: jest.fn(async () => []),
}));

const mockGetItem = AsyncStorage.getItem as unknown as jest.Mock;

function Sonda({ rol, cafeteriaIdSesion }: { rol?: Rol; cafeteriaIdSesion?: string | null }) {
  const cafeteriaId = useCafeteriaActual(rol, cafeteriaIdSesion ?? null);
  return <Text>{cafeteriaId ?? 'nada'}</Text>;
}

async function renderizarSonda(props: {
  rol?: Rol;
  cafeteriaIdSesion?: string | null;
}): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Sonda {...props} />);
  });
  return tree;
}

beforeEach(() => {
  mockGetItem.mockClear();
});

describe('useCafeteriaActual', () => {
  it('para un cajero devuelve el cafeteriaId de la sesión', async () => {
    const tree = await renderizarSonda({ rol: 'cajero', cafeteriaIdSesion: 'c-1' });

    expect(tree.root.findByType(Text).props.children).toBe('c-1');
  });

  it('para un cliente devuelve la cafetería del campus guardado', async () => {
    mockGetItem.mockResolvedValue(
      JSON.stringify({ id: 'san-francisco', nombre: 'Campus San Francisco' })
    );

    const tree = await renderizarSonda({ rol: 'cliente', cafeteriaIdSesion: null });

    expect(tree.root.findByType(Text).props.children).toBe('cafe-2');
  });

  it('para un cliente sin campus guardado devuelve null', async () => {
    mockGetItem.mockResolvedValue(null);

    const tree = await renderizarSonda({ rol: 'cliente', cafeteriaIdSesion: null });

    expect(tree.root.findByType(Text).props.children).toBe('nada');
  });

  it('para un cliente con campus corrupto devuelve null sin lanzar', async () => {
    mockGetItem.mockResolvedValue('{json-rotto');

    const tree = await renderizarSonda({ rol: 'cliente', cafeteriaIdSesion: null });

    expect(tree.root.findByType(Text).props.children).toBe('nada');
  });

  it('sin rol devuelve null', async () => {
    const tree = await renderizarSonda({ cafeteriaIdSesion: null });

    expect(tree.root.findByType(Text).props.children).toBe('nada');
  });
});
