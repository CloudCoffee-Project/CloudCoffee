// src/__tests__/cliente-mis-compras.test.tsx
// Cubre el historial de compras (INT4-50): carga/vacío/error con reintento, el
// listado con N°, estado y montos, y el enlace a la boleta en PDF de las
// órdenes de una compra pagada (INT4-48).
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import MisComprasScreen from '../app/(cliente)/mis-compras';
import { listarCompras } from '../services/compras';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '../services/httpClient';
import type { Compra, Orden } from '../types/domain';

jest.mock('../services/compras', () => ({
  listarCompras: jest.fn(),
}));

const mockRouter = { push: jest.fn() };

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

const mockListar = listarCompras as unknown as jest.Mock;
const mockUseFocusEffect = useFocusEffect as unknown as jest.Mock;

function orden(id: string, sobre: Partial<Orden> = {}): Orden {
  return {
    ordenId: `orden-${id}`,
    codigoOrden: `ORD-${id}`,
    cafeteriaId: 'caf-1',
    cafeteriaNombre: 'Cafetería Central',
    estado: 'entregado',
    montoTotal: 2300,
    items: [],
    ...sobre,
  };
}

function compra(id: string, sobre: Partial<Compra> = {}): Compra {
  return {
    compraId: `compra-${id}`,
    montoTotal: 4300,
    estado: 'pagado',
    ordenes: [orden(id)],
    ...sobre,
  };
}

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

// Renderiza la pantalla y ejecuta el callback que el mock de useFocusEffect
// capturó (equivale a que la pantalla gane foco y cargue el historial).
async function renderizarMisCompras(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<MisComprasScreen />);
  });

  const llamadas = mockUseFocusEffect.mock.calls;
  const callback = llamadas[llamadas.length - 1][0];
  await act(async () => {
    callback();
  });

  return tree;
}

beforeEach(() => {
  mockListar.mockReset();
  mockUseFocusEffect.mockReset();
  mockRouter.push.mockClear();
});

describe('pantalla de Mis Compras', () => {
  it('muestra el estado de carga mientras resuelve el historial', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(<MisComprasScreen />);
    });

    expect(tree.root.findByProps({ testID: 'compras-cargando' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('muestra el estado vacío cuando el cliente no tiene compras', async () => {
    mockListar.mockResolvedValue([]);

    const tree = await renderizarMisCompras();

    expect(tree.root.findByProps({ testID: 'compras-vacio' })).toBeDefined();
    expect(tree.root.findAllByProps({ testID: 'lista-compras' })).toHaveLength(0);

    act(() => tree.unmount());
  });

  it('lista las compras con su N°, estado y monto total', async () => {
    mockListar.mockResolvedValue([
      compra('c1'),
      compra('c2', { estado: 'cancelado', ordenes: [orden('x', { codigoOrden: 'ORD-9' })] }),
    ]);

    const tree = await renderizarMisCompras();

    const item1 = tree.root.findByProps({ testID: 'compra-item-compra-c1' });
    expect(textoDe(item1)).toContain('compra-c1');
    expect(textoDe(item1)).toContain('🟢 Pagado');
    expect(textoDe(item1)).toContain('$4.300');

    const item2 = tree.root.findByProps({ testID: 'compra-item-compra-c2' });
    expect(textoDe(item2)).toContain('compra-c2');
    expect(textoDe(item2)).toContain('⚪ Cancelado');

    act(() => tree.unmount());
  });

  it('muestra el error del listado con botón de reintentar', async () => {
    mockListar
      .mockRejectedValueOnce(new ApiError('Servicio no disponible', 503))
      .mockResolvedValueOnce([compra('c1')]);

    const tree = await renderizarMisCompras();

    const error = tree.root.findByProps({ testID: 'compras-error' });
    expect(textoDe(error)).toContain('Servicio no disponible');

    await act(async () => {
      tree.root.findByProps({ testID: 'reintentar-compras' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'compra-item-compra-c1' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('navega a la boleta en PDF de una orden de una compra pagada', async () => {
    mockListar.mockResolvedValue([compra('c1')]);

    const tree = await renderizarMisCompras();

    const boton = tree.root.findByProps({ testID: 'boleta-orden-orden-c1' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(cliente)/orden/[id]',
      params: { id: 'orden-c1', estado: 'entregado' },
    });

    act(() => tree.unmount());
  });

  it('no ofrece boleta para compras que aún no están pagadas', async () => {
    mockListar.mockResolvedValue([compra('c1', { estado: 'pendiente_pago' })]);

    const tree = await renderizarMisCompras();

    expect(tree.root.findAllByProps({ testID: 'boleta-orden-orden-c1' })).toHaveLength(0);
    expect(mockRouter.push).not.toHaveBeenCalled();

    act(() => tree.unmount());
  });
});
