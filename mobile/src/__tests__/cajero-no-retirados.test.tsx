// src/__tests__/cajero-no-retirados.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';

import NoRetiradosScreen from '../app/(cajero)/no-retirados';
import { fetchPedidosEntrantes, resolverOrdenNoRetirada } from '../services/ordenes';
import { getAccessToken } from '../services/httpClient';
import { useOrdenEstado } from '../hooks/useOrdenEstado';
import type { Orden } from '../types/domain';

jest.mock('../services/ordenes', () => ({
  fetchPedidosEntrantes: jest.fn(),
  resolverOrdenNoRetirada: jest.fn(),
}));

jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn() };
});

jest.mock('../hooks/useOrdenEstado', () => ({
  useOrdenEstado: jest.fn(() => null),
}));

const mockGetAccessToken = getAccessToken as unknown as jest.Mock;
const mockFetchPedidos = fetchPedidosEntrantes as unknown as jest.Mock;
const mockResolverOrden = resolverOrdenNoRetirada as unknown as jest.Mock;
const mockUseOrdenEstado = useOrdenEstado as unknown as jest.Mock;

// Mezcla de estados: activos y entregado quedan fuera del listado (solo se
// muestran los estados no retirados del union EstadoOrden).
const ordenesMock: Orden[] = [
  {
    ordenId: 'o-1',
    codigoOrden: 'CC-9801',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Ignacio Soto',
    estado: 'listo_para_retiro',
    montoTotal: 4300,
    items: [
      {
        ordenItemId: 'itm-1',
        productoNombre: 'Café Americano 12oz',
        cantidad: 1,
        precioUnitario: 1800,
      },
    ],
  },
  {
    ordenId: 'o-2',
    codigoOrden: 'CC-9802',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Camila Vergara',
    estado: 'entregado',
    montoTotal: 4000,
    items: [
      {
        ordenItemId: 'itm-2',
        productoNombre: 'Jugo Natural Naranja 300ml',
        cantidad: 2,
        precioUnitario: 2000,
      },
    ],
  },
  {
    ordenId: 'o-3',
    codigoOrden: 'CC-9803',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Diego Morales',
    estado: 'no_retirado_pendiente_revision',
    montoTotal: 2500,
    items: [
      {
        ordenItemId: 'itm-3',
        productoNombre: 'Muffin Chocolate',
        cantidad: 2,
        precioUnitario: 1250,
      },
    ],
  },
  {
    ordenId: 'o-4',
    codigoOrden: 'CC-9804',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Ana Pérez',
    estado: 'no_retirado_final',
    montoTotal: 2000,
    items: [
      {
        ordenItemId: 'itm-4',
        productoNombre: 'Jugo Natural Naranja 300ml',
        cantidad: 1,
        precioUnitario: 2000,
      },
    ],
  },
];

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

function dataDe(tree: ReactTestRenderer): Orden[] {
  const lista = tree.root.findByType(FlatList);
  return lista.props.data as Orden[];
}

async function renderizarNoRetirados(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<NoRetiradosScreen />);
    // Permite que resuelvan las promesas del fetch inicial dentro del act.
    await Promise.resolve();
  });
  return tree;
}

// Orden pendiente de revisión con dos ítems: exige decidir ambos antes de
// confirmar (flujo INT4-12).
const ordenRevisionDosItems: Orden = {
  ordenId: 'o-5',
  codigoOrden: 'CC-9805',
  cafeteriaId: 'c-1',
  cafeteriaNombre: 'Cafetería Central',
  clienteNombre: 'Francisca Ríos',
  estado: 'no_retirado_pendiente_revision',
  montoTotal: 4900,
  items: [
    {
      ordenItemId: 'itm-5',
      productoNombre: 'Té Chai Latte 12oz',
      cantidad: 1,
      precioUnitario: 3400,
    },
    {
      ordenItemId: 'itm-6',
      productoNombre: 'Brownie Chocolate',
      cantidad: 1,
      precioUnitario: 1500,
    },
  ],
};

describe('Listado de órdenes no retiradas del cajero (INT4-11)', () => {
  beforeEach(() => {
    mockGetAccessToken.mockReset();
    mockFetchPedidos.mockReset();
    mockResolverOrden.mockReset();
    mockUseOrdenEstado.mockReset();
    mockUseOrdenEstado.mockReturnValue(null);
  });

  it('carga las órdenes con el token real y muestra solo las no retiradas', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    expect(mockGetAccessToken).toHaveBeenCalled();
    expect(mockFetchPedidos).toHaveBeenCalledWith('token-real');
    // Quedan fuera los pedidos activos (listo_para_retiro) y entregados.
    expect(dataDe(tree)).toEqual([ordenesMock[2], ordenesMock[3]]);

    act(() => tree.unmount());
  }, 20000);

  it('filtra por las categorías "Revisión" y "Finales" del union EstadoOrden', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    expect(dataDe(tree)).toEqual([ordenesMock[2], ordenesMock[3]]);

    const chipRevision = tree.root.findByProps({ testID: 'cajero-nr-chip-revision' });
    await act(async () => {
      chipRevision.props.onPress();
    });
    expect(dataDe(tree)).toEqual([ordenesMock[2]]);

    const chipFinal = tree.root.findByProps({ testID: 'cajero-nr-chip-final' });
    await act(async () => {
      chipFinal.props.onPress();
    });
    expect(dataDe(tree)).toEqual([ordenesMock[3]]);

    const chipTodos = tree.root.findByProps({ testID: 'cajero-nr-chip-todos' });
    await act(async () => {
      chipTodos.props.onPress();
    });
    expect(dataDe(tree)).toEqual([ordenesMock[2], ordenesMock[3]]);

    act(() => tree.unmount());
  }, 20000);

  it('muestra el badge del estado en cada tarjeta', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    const rowRevision = tree.root.findByProps({ testID: 'cajero-no-retirado-o-3' });
    expect(textoDe(rowRevision)).toContain('No Retirado · Revisión');

    const rowFinal = tree.root.findByProps({ testID: 'cajero-no-retirado-o-4' });
    expect(textoDe(rowFinal)).toContain('No Retirado');

    act(() => tree.unmount());
  }, 20000);

  it('usa el estado en vivo (WebSocket) para la etiqueta de la tarjeta', async () => {
    // o-3 (base: pendiente de revisión) llega en vivo como no_retirado_final.
    mockUseOrdenEstado.mockImplementation((ordenId: string) =>
      ordenId === 'o-3' ? 'no_retirado_final' : null
    );
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    // El badge usa el estado en vivo: o-3 (base: pendiente de revisión) llega
    // como final, así el badge no muestra "· Revisión".
    const badge = tree.root.findByProps({ testID: 'cajero-nr-badge-o-3' });
    expect(textoDe(badge)).toContain('No Retirado');
    expect(textoDe(badge)).not.toContain('Revisión');

    act(() => tree.unmount());
  }, 20000);

  it('muestra el error de la API con toApiError', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockRejectedValue(new Error('Request failed with status code 503'));

    const tree = await renderizarNoRetirados();

    const banner = tree.root.findByProps({ testID: 'cajero-nr-error' });
    expect(textoDe(banner)).toContain('503');

    act(() => tree.unmount());
  });

  it('no rompe sin token: delega el error a la API', async () => {
    mockGetAccessToken.mockReturnValue(null);
    mockFetchPedidos.mockRejectedValue(new Error('Request failed with status code 401'));

    const tree = await renderizarNoRetirados();

    expect(mockFetchPedidos).toHaveBeenCalledWith('');
    const banner = tree.root.findByProps({ testID: 'cajero-nr-error' });
    expect(textoDe(banner)).toContain('401');

    act(() => tree.unmount());
  });

  it('muestra el estado vacío cuando no hay órdenes no retiradas', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue([]);

    const tree = await renderizarNoRetirados();

    const vacio = tree.root.findByProps({ testID: 'cajero-nr-vacio' });
    expect(textoDe(vacio)).toContain('No hay órdenes no retiradas');

    act(() => tree.unmount());
  });

  it('muestra el mensaje vacío específico para el chip de revisión', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue([ordenesMock[3]]);

    const tree = await renderizarNoRetirados();

    const chipRevision = tree.root.findByProps({ testID: 'cajero-nr-chip-revision' });
    await act(async () => {
      chipRevision.props.onPress();
    });

    const vacio = tree.root.findByProps({ testID: 'cajero-nr-vacio' });
    expect(textoDe(vacio)).toContain('No hay órdenes no retiradas pendientes de revisión.');

    act(() => tree.unmount());
  }, 20000);

  it('muestra las acciones de decisión solo en órdenes pendientes de revisión', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    // o-3 (pendiente de revisión) tiene los botones por ítem y confirmar.
    expect(tree.root.findByProps({ testID: 'cajero-nr-accion-itm-3-reingresar' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'cajero-nr-accion-itm-3-descartar' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-3' })).toBeTruthy();

    // o-4 (final) es solo lectura: sin botones de decisión ni confirmación.
    expect(() => tree.root.findByProps({ testID: 'cajero-nr-accion-itm-4-reingresar' })).toThrow();
    expect(() => tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-4' })).toThrow();

    act(() => tree.unmount());
  }, 20000);

  it('exige decidir todos los ítems antes de confirmar', async () => {
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    const confirmar = tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-3' });
    await act(async () => {
      confirmar.props.onPress();
    });

    const errorBanner = tree.root.findByProps({ testID: 'cajero-nr-error-o-3' });
    expect(textoDe(errorBanner)).toContain(
      'Debes seleccionar una acción (Reingresar o Descartar) para cada ítem antes de confirmar.'
    );
    expect(mockResolverOrden).not.toHaveBeenCalled();
    // La orden permanece en el listado.
    expect(dataDe(tree).map((o) => o.ordenId)).toContain('o-3');

    act(() => tree.unmount());
  }, 20000);

  it('confirma la orden con las decisiones, llama al servicio y la quita del listado', async () => {
    mockResolverOrden.mockResolvedValue({ ...ordenesMock[2], estado: 'no_retirado_final' });
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    const btnReingresar = tree.root.findByProps({
      testID: 'cajero-nr-accion-itm-3-reingresar',
    });
    await act(async () => {
      btnReingresar.props.onPress();
    });

    const confirmar = tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-3' });
    await act(async () => {
      confirmar.props.onPress();
    });

    expect(mockResolverOrden).toHaveBeenCalledWith(
      'o-3',
      [{ ordenItemId: 'itm-3', accion: 'reingresar' }],
      'token-real'
    );
    expect(dataDe(tree).map((o) => o.ordenId)).not.toContain('o-3');
    const exito = tree.root.findByProps({ testID: 'cajero-nr-exito' });
    expect(textoDe(exito)).toContain('CC-9803');
    expect(textoDe(exito)).toContain('1 ítem(s) reingresado(s)');

    act(() => tree.unmount());
  }, 20000);

  it('permite cambiar la decisión de un ítem antes de confirmar', async () => {
    mockResolverOrden.mockResolvedValue({ ...ordenesMock[2], estado: 'no_retirado_final' });
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    const btnReingresar = tree.root.findByProps({
      testID: 'cajero-nr-accion-itm-3-reingresar',
    });
    await act(async () => {
      btnReingresar.props.onPress();
    });
    const btnDescartar = tree.root.findByProps({ testID: 'cajero-nr-accion-itm-3-descartar' });
    await act(async () => {
      btnDescartar.props.onPress();
    });

    const confirmar = tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-3' });
    await act(async () => {
      confirmar.props.onPress();
    });

    expect(mockResolverOrden).toHaveBeenCalledWith(
      'o-3',
      [{ ordenItemId: 'itm-3', accion: 'descartar' }],
      'token-real'
    );

    act(() => tree.unmount());
  }, 20000);

  it('muestra el error normalizado de la API al confirmar y mantiene la orden', async () => {
    mockResolverOrden.mockRejectedValue(new Error('Request failed with status code 503'));
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue(ordenesMock);

    const tree = await renderizarNoRetirados();

    const btnReingresar = tree.root.findByProps({
      testID: 'cajero-nr-accion-itm-3-reingresar',
    });
    await act(async () => {
      btnReingresar.props.onPress();
    });
    const confirmar = tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-3' });
    await act(async () => {
      confirmar.props.onPress();
    });

    const errorBanner = tree.root.findByProps({ testID: 'cajero-nr-error-o-3' });
    expect(textoDe(errorBanner)).toContain('503');
    expect(dataDe(tree).map((o) => o.ordenId)).toContain('o-3');

    act(() => tree.unmount());
  }, 20000);

  it('con dos ítems: exige decidir ambos, limpia el error y confirma', async () => {
    mockResolverOrden.mockResolvedValue({ ...ordenRevisionDosItems, estado: 'no_retirado_final' });
    mockGetAccessToken.mockReturnValue('token-real');
    mockFetchPedidos.mockResolvedValue([ordenesMock[2], ordenRevisionDosItems]);

    const tree = await renderizarNoRetirados();

    // Solo una decisión: debe fallar la validación sin llamar al servicio.
    const btnReingresarItm5 = tree.root.findByProps({
      testID: 'cajero-nr-accion-itm-5-reingresar',
    });
    await act(async () => {
      btnReingresarItm5.props.onPress();
    });
    const confirmar = tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-5' });
    await act(async () => {
      confirmar.props.onPress();
    });
    expect(mockResolverOrden).not.toHaveBeenCalled();
    const errorBanner = tree.root.findByProps({ testID: 'cajero-nr-error-o-5' });
    expect(textoDe(errorBanner)).toContain('para cada ítem antes de confirmar');

    // Decidir el segundo ítem limpia el error y permite confirmar.
    const btnDescartarItm6 = tree.root.findByProps({
      testID: 'cajero-nr-accion-itm-6-descartar',
    });
    await act(async () => {
      btnDescartarItm6.props.onPress();
    });
    const confirmar2 = tree.root.findByProps({ testID: 'cajero-nr-confirmar-o-5' });
    await act(async () => {
      confirmar2.props.onPress();
    });

    expect(mockResolverOrden).toHaveBeenCalledWith(
      'o-5',
      [
        { ordenItemId: 'itm-5', accion: 'reingresar' },
        { ordenItemId: 'itm-6', accion: 'descartar' },
      ],
      'token-real'
    );
    expect(() => tree.root.findByProps({ testID: 'cajero-nr-error-o-5' })).toThrow();

    act(() => tree.unmount());
  }, 20000);
});
