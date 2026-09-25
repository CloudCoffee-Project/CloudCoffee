// src/__tests__/cliente-mis-seguimientos.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import MisSeguimientosScreen from '../app/(cliente)/mis-seguimientos';
import { eliminarSeguimiento, listarSeguimientos } from '../services/seguimientos';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '../services/httpClient';
import type { Seguimiento } from '../types/domain';

const alertSpy = jest.spyOn(Alert, 'alert');

jest.mock('../services/seguimientos', () => ({
  listarSeguimientos: jest.fn(),
  eliminarSeguimiento: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: (props: { children?: React.ReactNode } & Record<string, unknown>) =>
      React.createElement(View, props, props.children),
  };
});

const mockListar = listarSeguimientos as unknown as jest.Mock;
const mockEliminar = eliminarSeguimiento as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;

function seguimiento(id: string, sobre: Partial<Seguimiento> = {}): Seguimiento {
  return {
    id,
    productoId: `producto-${id}`,
    productoNombre: `Producto ${id}`,
    cafeteriaId: null,
    ...sobre,
  };
}

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

// Renderiza la pantalla y ejecuta el callback que el mock de useFocusEffect
// capturó (equivale a que la pantalla gane foco y cargue el listado).
async function renderizarSeguimientos(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<MisSeguimientosScreen />);
  });

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });

  return tree;
}

// Simula confirmar la eliminación en el Alert: ejecuta el onPress del botón
// "Eliminar" que la pantalla registró en la última llamada a Alert.alert.
async function confirmarEliminacion(): Promise<void> {
  const llamada = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const botones = llamada[2] as { text: string; onPress?: () => void }[];
  const botonEliminar = botones.find((b) => b.text === 'Eliminar');

  expect(botonEliminar?.onPress).toBeDefined();
  await act(async () => {
    botonEliminar?.onPress?.();
  });
}

beforeEach(() => {
  alertSpy.mockClear();
  mockListar.mockReset();
  mockEliminar.mockReset();
  mockUseFocusEffect.mockReset();
});

describe('pantalla de Mis Seguimientos', () => {
  it('muestra el estado de carga mientras resuelve el listado', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<MisSeguimientosScreen />);
    });

    expect(tree.root.findByProps({ testID: 'seguimientos-cargando' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('muestra el estado vacío cuando el cliente no sigue productos', async () => {
    mockListar.mockResolvedValue([]);

    const tree = await renderizarSeguimientos();

    expect(tree.root.findByProps({ testID: 'seguimientos-vacio' })).toBeDefined();
    expect(tree.root.findAllByProps({ testID: 'lista-seguimientos' })).toHaveLength(0);

    act(() => tree.unmount());
  });

  it('lista los seguimientos con su distintivo general o de cafetería', async () => {
    mockListar.mockResolvedValue([
      seguimiento('seg-1', { productoNombre: 'Café de especialidad', cafeteriaId: null }),
      seguimiento('seg-2', {
        productoNombre: 'Té en hebras',
        cafeteriaId: 'caf-9',
        cafeteriaNombre: 'Cafetería Central',
      }),
    ]);

    const tree = await renderizarSeguimientos();

    const item1 = tree.root.findByProps({ testID: 'seguimiento-item-seg-1' });
    expect(textoDe(item1)).toContain('Café de especialidad');
    expect(textoDe(item1)).toContain('General');

    const item2 = tree.root.findByProps({ testID: 'seguimiento-item-seg-2' });
    expect(textoDe(item2)).toContain('Té en hebras');
    expect(textoDe(item2)).toContain('Cafetería Central');

    act(() => tree.unmount());
  });

  it('muestra el error del listado con botón de reintentar', async () => {
    mockListar
      .mockRejectedValueOnce(new ApiError('Servicio no disponible', 503))
      .mockResolvedValueOnce([seguimiento('seg-1', { productoNombre: 'Café en grano' })]);

    const tree = await renderizarSeguimientos();

    const error = tree.root.findByProps({ testID: 'seguimientos-error' });
    expect(textoDe(error)).toContain('Servicio no disponible');

    await act(async () => {
      tree.root.findByProps({ testID: 'reintentar-seguimientos' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'seguimiento-item-seg-1' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('confirma antes de eliminar y remueve el ítem del listado local', async () => {
    mockListar.mockResolvedValue([
      seguimiento('seg-1', { productoNombre: 'Café de especialidad' }),
      seguimiento('seg-2', { productoNombre: 'Té en hebras' }),
    ]);
    mockEliminar.mockResolvedValue(undefined);

    const tree = await renderizarSeguimientos();

    const boton = tree.root.findByProps({ testID: 'eliminar-seguimiento-seg-1' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][1]).toContain('Café de especialidad');

    await confirmarEliminacion();

    expect(mockEliminar).toHaveBeenCalledWith('seg-1');
    expect(tree.root.findAllByProps({ testID: 'seguimiento-item-seg-1' })).toHaveLength(0);
    expect(tree.root.findByProps({ testID: 'seguimiento-item-seg-2' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('no elimina si se cancela la confirmación', async () => {
    mockListar.mockResolvedValue([seguimiento('seg-1', { productoNombre: 'Café' })]);
    mockEliminar.mockResolvedValue(undefined);

    const tree = await renderizarSeguimientos();

    const boton = tree.root.findByProps({ testID: 'eliminar-seguimiento-seg-1' });
    await act(async () => {
      boton.props.onPress();
    });

    const botones = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const botonCancelar = botones.find((b) => b.text === 'Cancelar');
    await act(async () => {
      botonCancelar?.onPress?.();
    });

    expect(mockEliminar).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'seguimiento-item-seg-1' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('muestra el error normalizado si falla la eliminación', async () => {
    mockListar.mockResolvedValue([seguimiento('seg-1', { productoNombre: 'Café' })]);
    mockEliminar.mockRejectedValue(new ApiError('No se pudo eliminar el seguimiento', 500));

    const tree = await renderizarSeguimientos();

    const boton = tree.root.findByProps({ testID: 'eliminar-seguimiento-seg-1' });
    await act(async () => {
      boton.props.onPress();
    });
    await confirmarEliminacion();

    const banner = tree.root.findByProps({ testID: 'error-eliminar' });
    expect(textoDe(banner)).toContain('No se pudo eliminar el seguimiento');
    expect(tree.root.findByProps({ testID: 'seguimiento-item-seg-1' })).toBeDefined();

    act(() => tree.unmount());
  });
});
