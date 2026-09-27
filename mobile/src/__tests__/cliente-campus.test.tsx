// src/__tests__/cliente-campus.test.tsx
// Cubre la selección de campus (INT4-27): el listado sale del catálogo real
// (nunca de una lista local), la confirmación persiste la sede y entra al
// catálogo, y el error del gateway se muestra normalizado con reintento.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import CampusScreen from '../app/(cliente)/campus';
import {
  guardarCampusSeleccionado,
  leerCampusSeleccionado,
  listarCampus,
} from '../services/catalog';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '../services/httpClient';
import type { Campus } from '../types/domain';

jest.mock('../services/catalog', () => ({
  guardarCampusSeleccionado: jest.fn(),
  leerCampusSeleccionado: jest.fn(),
  listarCampus: jest.fn(),
}));

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockRouter = { replace: jest.fn(), back: jest.fn() };

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: (props: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(View, props, props.children),
  };
});

const mockListar = listarCampus as unknown as jest.Mock;
const mockLeer = leerCampusSeleccionado as unknown as jest.Mock;
const mockGuardar = guardarCampusSeleccionado as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;

const campusMock: Campus[] = [
  { id: 'campus-1', nombre: 'Campus San Francisco', direccion: 'Manuel Montt 056, Temuco' },
  { id: 'campus-2', nombre: 'Campus San Juan Pablo II', direccion: 'Peligde, Temuco' },
];

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

// Renderiza la pantalla y ejecuta el callback que el mock de useFocusEffect
// capturó (equivale a que la pantalla gane foco y cargue el campus).
// Último árbol renderizado, para desmontarlo al final de cada test.
let arbolActual: ReactTestRenderer | null = null;

async function renderCampus(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<CampusScreen />);
  });
  arbolActual = tree;

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });

  return tree;
}

beforeEach(() => {
  mockListar.mockReset();
  mockLeer.mockReset();
  mockGuardar.mockReset();
  mockUseFocusEffect.mockReset();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
  mockListar.mockResolvedValue(campusMock);
  mockLeer.mockResolvedValue(null);
  mockGuardar.mockResolvedValue(undefined);
});

// Desmontar al terminar cada test para que ningún timer pendiente dispare un
// setState fuera de act().
afterEach(() => {
  if (arbolActual !== null) {
    act(() => arbolActual?.unmount());
    arbolActual = null;
  }
});

describe('Selección de campus', () => {
  it('carga el listado desde el catálogo real', async () => {
    const tree = await renderCampus();

    expect(mockListar).toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'campus-card-campus-1' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'campus-card-campus-2' })).toBeTruthy();
  });

  it('preselecciona el primer campus cuando no hay selección previa', async () => {
    const tree = await renderCampus();

    const primera = tree.root.findByProps({ testID: 'campus-card-campus-1' });
    const segunda = tree.root.findByProps({ testID: 'campus-card-campus-2' });

    expect(textoDe(primera)).toContain('✓');
    expect(textoDe(segunda)).toContain('›');
  });

  it('preselecciona el campus guardado si sigue en el catálogo', async () => {
    mockLeer.mockResolvedValue(campusMock[1]);

    const tree = await renderCampus();

    const primera = tree.root.findByProps({ testID: 'campus-card-campus-1' });
    const segunda = tree.root.findByProps({ testID: 'campus-card-campus-2' });

    expect(textoDe(segunda)).toContain('✓');
    expect(textoDe(primera)).toContain('›');
  });

  it('preselecciona el primer campus si el guardado ya no está en el catálogo', async () => {
    mockLeer.mockResolvedValue({ id: 'campus-obsoleto', nombre: 'Sede antigua', direccion: '' });

    const tree = await renderCampus();

    const primera = tree.root.findByProps({ testID: 'campus-card-campus-1' });
    expect(textoDe(primera)).toContain('✓');
  });

  it('ofrece volver al catálogo si ya había una selección previa', async () => {
    mockLeer.mockResolvedValue(campusMock[0]);

    const tree = await renderCampus();

    expect(tree.root.findByProps({ testID: 'campus-volver' })).toBeTruthy();
  });

  it('no ofrece volver al catálogo en el primer ingreso', async () => {
    const tree = await renderCampus();

    expect(() => tree.root.findByProps({ testID: 'campus-volver' })).toThrow();
  });

  it('guarda el campus elegido y entra al catálogo al confirmar', async () => {
    const tree = await renderCampus();

    await act(async () => {
      tree.root.findByProps({ testID: 'campus-card-campus-2' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'campus-confirmar' }).props.onPress();
    });

    expect(mockGuardar).toHaveBeenCalledWith(campusMock[1]);
    expect(mockRouter.replace).toHaveBeenCalledWith('/(cliente)');
  });

  it('muestra el error normalizado con botón de reintentar', async () => {
    mockListar.mockRejectedValue(new ApiError('No pudimos listar los campus', 500));

    const tree = await renderCampus();

    expect(tree.root.findByProps({ testID: 'campus-error' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'campus-reintentar' })).toBeTruthy();
  });

  it('reintenta la carga al pulsar el botón', async () => {
    mockListar.mockRejectedValue(new ApiError('No pudimos listar los campus', 500));
    const tree = await renderCampus();
    const llamadasAntes = mockListar.mock.calls.length;

    mockListar.mockResolvedValue(campusMock);
    await act(async () => {
      tree.root.findByProps({ testID: 'campus-reintentar' }).props.onPress();
    });

    expect(mockListar.mock.calls.length).toBe(llamadasAntes + 1);
    expect(tree.root.findByProps({ testID: 'campus-lista' })).toBeTruthy();
  });

  it('muestra vacío cuando el catálogo no tiene campus', async () => {
    mockListar.mockResolvedValue([]);

    const tree = await renderCampus();

    expect(tree.root.findByProps({ testID: 'campus-vacio' })).toBeTruthy();
  });

  it('muestra el error de guardado si la persistencia falla', async () => {
    mockGuardar.mockRejectedValue(new Error('almacenamiento lleno'));
    const tree = await renderCampus();

    await act(async () => {
      tree.root.findByProps({ testID: 'campus-confirmar' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'campus-error-guardado' })).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
