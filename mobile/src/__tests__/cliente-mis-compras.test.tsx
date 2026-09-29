// src/__tests__/cliente-mis-compras.test.tsx
// Cubre el historial de compras (INT4-50): carga/vacío/error con reintento, el
// listado con N°, estado y montos, y el enlace a la boleta en PDF de las
// órdenes de una compra pagada (INT4-48).
//
// Y las acciones del cliente (INT4-37): confirmar o cancelar la compra
// completa o una orden puntual, solo en los estados que lo permiten; la
// cancelación pide confirmación en pantalla antes de llamar al backend; la
// acción en vuelo deshabilita los botones para no repetirse; y el resultado
// (éxito con recarga del historial, o error del backend) se muestra en pantalla.
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import MisComprasScreen from '../app/(cliente)/mis-compras';
import { cancelarCompra, confirmarCompra, listarCompras } from '../services/compras';
import { cancelarOrden, confirmarOrden } from '../services/ordenes';
import { useFocusEffect } from 'expo-router';
import { ApiError } from '../services/httpClient';
import type { Compra, Orden } from '../types/domain';

jest.mock('../services/compras', () => ({
  listarCompras: jest.fn(),
  confirmarCompra: jest.fn(),
  cancelarCompra: jest.fn(),
}));

jest.mock('../services/ordenes', () => ({
  confirmarOrden: jest.fn(),
  cancelarOrden: jest.fn(),
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
const mockConfirmarCompra = confirmarCompra as unknown as jest.Mock;
const mockCancelarCompra = cancelarCompra as unknown as jest.Mock;
const mockConfirmarOrden = confirmarOrden as unknown as jest.Mock;
const mockCancelarOrden = cancelarOrden as unknown as jest.Mock;
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
  mockConfirmarCompra.mockReset();
  mockCancelarCompra.mockReset();
  mockConfirmarOrden.mockReset();
  mockCancelarOrden.mockReset();
  mockUseFocusEffect.mockReset();
  mockRouter.push.mockClear();
  mockConfirmarCompra.mockResolvedValue({});
  mockCancelarCompra.mockResolvedValue({});
  mockConfirmarOrden.mockResolvedValue({});
  mockCancelarOrden.mockResolvedValue({});
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

// INT4-37: confirmar o cancelar la compra completa o una orden puntual.
describe('confirmar y cancelar desde Mis Compras (INT4-37)', () => {
  it('confirma la compra completa y recarga el historial con el estado nuevo', async () => {
    mockListar
      .mockResolvedValueOnce([
        compra('c1', { estado: 'reservando', ordenes: [orden('c1', { estado: 'reservando' })] }),
      ])
      .mockResolvedValue([
        compra('c1', { estado: 'pagado', ordenes: [orden('c1', { estado: 'pagado' })] }),
      ]);

    const tree = await renderizarMisCompras();
    expect(textoDe(tree.root.findByProps({ testID: 'compra-item-compra-c1' }))).toContain(
      '🔵 Reservando'
    );

    await act(async () => {
      tree.root.findByProps({ testID: 'compra-confirmar-compra-c1' }).props.onPress();
    });

    expect(mockConfirmarCompra).toHaveBeenCalledWith('compra-c1');
    // No es un POST de orden: confirmar la compra completa no toca pedidos sueltos.
    expect(mockConfirmarOrden).not.toHaveBeenCalled();
    expect(mockCancelarCompra).not.toHaveBeenCalled();
    // Tras la acción se recarga el historial y se muestra el estado que devolvió
    // el backend (aquí, ya pagada: sin acciones disponibles).
    expect(mockListar).toHaveBeenCalledTimes(2);
    expect(textoDe(tree.root.findByProps({ testID: 'compras-accion-mensaje' }))).toContain(
      'Confirmaste la compra'
    );
    const tarjeta = tree.root.findByProps({ testID: 'compra-item-compra-c1' });
    expect(textoDe(tarjeta)).toContain('🟢 Pagado');
    expect(tree.root.findAllByProps({ testID: 'compra-confirmar-compra-c1' })).toHaveLength(0);

    act(() => tree.unmount());
  });

  it('cancelar la compra pide confirmación en pantalla y solo después llama al backend', async () => {
    mockListar.mockResolvedValue([compra('c1', { estado: 'reservando' })]);

    const tree = await renderizarMisCompras();

    // El primer toque solo abre la confirmación: no se cancela nada todavía.
    await act(async () => {
      tree.root.findByProps({ testID: 'compra-cancelar-compra-c1' }).props.onPress();
    });
    expect(mockCancelarCompra).not.toHaveBeenCalled();
    const pregunta = tree.root.findByProps({ testID: 'compra-confirmar-cancelacion-compra-c1' });
    expect(textoDe(pregunta)).toContain('¿Cancelar la compra completa');

    // "No, mantener" cierra la pregunta sin cancelar.
    await act(async () => {
      tree.root.findByProps({ testID: 'compra-mantener-compra-c1' }).props.onPress();
    });
    expect(mockCancelarCompra).not.toHaveBeenCalled();
    expect(
      tree.root.findAllByProps({ testID: 'compra-confirmar-cancelacion-compra-c1' })
    ).toHaveLength(0);

    // Ahora sí: confirmar la cancelación llama al endpoint de la compra.
    await act(async () => {
      tree.root.findByProps({ testID: 'compra-cancelar-compra-c1' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'compra-cancelar-confirmado-compra-c1' }).props.onPress();
    });

    expect(mockCancelarCompra).toHaveBeenCalledWith('compra-c1');
    expect(mockConfirmarCompra).not.toHaveBeenCalled();
    expect(textoDe(tree.root.findByProps({ testID: 'compras-accion-mensaje' }))).toContain(
      'Cancelaste la compra'
    );

    act(() => tree.unmount());
  });

  it('solo ofrece las acciones que el estado permite', async () => {
    mockListar.mockResolvedValue([
      // Pagada: la cafetería ya la cobró, no hay nada que hacer.
      compra('pagada', { estado: 'pagado' }),
      // Cancelada: es historial, no se vuelve a tocar.
      compra('cancelada', { estado: 'cancelado' }),
      // En revisión: se puede cancelar, no confirmar (INT4-36 la dejó en revisión).
      compra('revision', { estado: 'revision_requerida' }),
      // Pendiente de pago: se puede cancelar, no confirmar.
      compra('pendiente', { estado: 'pendiente_pago' }),
    ]);

    const tree = await renderizarMisCompras();

    expect(tree.root.findAllByProps({ testID: 'compra-acciones-compra-pagada' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'compra-confirmar-compra-pagada' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'compra-cancelar-compra-cagada' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'compra-confirmar-compra-cancelada' })).toHaveLength(
      0
    );

    // En revisión y pendiente de pago: solo cancelar.
    expect(tree.root.findAllByProps({ testID: 'compra-confirmar-compra-revision' })).toHaveLength(
      0
    );
    expect(tree.root.findByProps({ testID: 'compra-cancelar-compra-revision' })).toBeDefined();
    expect(tree.root.findAllByProps({ testID: 'compra-confirmar-compra-pendiente' })).toHaveLength(
      0
    );
    expect(tree.root.findByProps({ testID: 'compra-cancelar-compra-pendiente' })).toBeDefined();

    act(() => tree.unmount());
  });

  it('confirma una orden puntual sin tocar el resto de la compra', async () => {
    mockListar.mockResolvedValue([
      compra('c1', {
        estado: 'pendiente_pago',
        ordenes: [
          orden('a', { codigoOrden: 'ORD-A', estado: 'reservando' }),
          orden('b', { codigoOrden: 'ORD-B', estado: 'pagado' }),
        ],
      }),
    ]);

    const tree = await renderizarMisCompras();

    // La orden reservando sí se puede confirmar; la que ya está pagada no.
    await act(async () => {
      tree.root.findByProps({ testID: 'orden-confirmar-orden-a' }).props.onPress();
    });

    expect(mockConfirmarOrden).toHaveBeenCalledWith('orden-a');
    expect(mockCancelarOrden).not.toHaveBeenCalled();
    // La compra completa no se toca al actuar sobre un solo pedido.
    expect(mockConfirmarCompra).not.toHaveBeenCalled();
    expect(mockCancelarCompra).not.toHaveBeenCalled();

    act(() => tree.unmount());
  });

  it('cancela un pedido puntual con su propia confirmación', async () => {
    mockListar.mockResolvedValue([
      compra('c1', {
        estado: 'reservando',
        ordenes: [orden('a', { codigoOrden: 'ORD-A', estado: 'reservando' })],
      }),
    ]);

    const tree = await renderizarMisCompras();

    // La orden ya pagada de otra compra no tiene acciones (arriba lo cubre el
    // caso de la orden pagada); acá la reservando sí.
    await act(async () => {
      tree.root.findByProps({ testID: 'orden-cancelar-orden-a' }).props.onPress();
    });
    expect(mockCancelarOrden).not.toHaveBeenCalled();
    expect(
      textoDe(tree.root.findByProps({ testID: 'orden-confirmacion-cancelar-orden-a' }))
    ).toContain('¿Cancelar el pedido #ORD-A');

    await act(async () => {
      tree.root.findByProps({ testID: 'orden-confirmar-cancelacion-orden-a' }).props.onPress();
    });

    expect(mockCancelarOrden).toHaveBeenCalledWith('orden-a');
    expect(mockCancelarCompra).not.toHaveBeenCalled();

    act(() => tree.unmount());
  });

  it('muestra el error del backend y no recarga si la acción falla', async () => {
    mockListar.mockResolvedValue([compra('c1', { estado: 'reservando' })]);
    mockConfirmarCompra.mockRejectedValue(new ApiError('No se puede confirmar aún', 409));

    const tree = await renderizarMisCompras();

    await act(async () => {
      tree.root.findByProps({ testID: 'compra-confirmar-compra-c1' }).props.onPress();
    });

    const error = tree.root.findByProps({ testID: 'compras-accion-error' });
    expect(textoDe(error)).toContain('No pudimos completar la acción');
    expect(textoDe(error)).toContain('No se puede confirmar aún');
    // La lista sigue como estaba: no se recarga ni se pierde el historial.
    expect(mockListar).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({ testID: 'compra-item-compra-c1' })).toBeDefined();
    // Y el botón vuelve a estar disponible para reintentar la acción.
    expect(tree.root.findByProps({ testID: 'compra-confirmar-compra-c1' }).props.disabled).toBe(
      false
    );

    act(() => tree.unmount());
  });

  it('con la acción en vuelo el botón se deshabilita y no se repite', async () => {
    mockListar.mockResolvedValue([compra('c1', { estado: 'reservando' })]);
    // Promesa pendiente: el test controla cuándo termina la llamada.
    let terminar!: () => void;
    mockConfirmarCompra.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        })
    );

    const tree = await renderizarMisCompras();

    await act(async () => {
      tree.root.findByProps({ testID: 'compra-confirmar-compra-c1' }).props.onPress();
    });

    // Mientras viaja: spinner en el botón pulsado y deshabilitado.
    expect(tree.root.findByProps({ testID: 'compra-confirmar-cargando-compra-c1' })).toBeDefined();
    expect(tree.root.findByProps({ testID: 'compra-confirmar-compra-c1' }).props.disabled).toBe(
      true
    );

    // Un segundo toque no dispara una segunda llamada.
    await act(async () => {
      tree.root.findByProps({ testID: 'compra-confirmar-compra-c1' }).props.onPress();
    });
    expect(mockConfirmarCompra).toHaveBeenCalledTimes(1);

    await act(async () => {
      terminar();
    });

    // Al terminar se recarga y el botón queda habilitado otra vez.
    expect(mockListar).toHaveBeenCalledTimes(2);
    expect(tree.root.findByProps({ testID: 'compra-confirmar-compra-c1' }).props.disabled).toBe(
      false
    );

    act(() => tree.unmount());
  });
});
