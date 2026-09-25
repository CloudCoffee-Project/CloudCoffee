// src/__tests__/cajero-flujo-completo.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { FlatList } from 'react-native';
import type { ReactElement } from 'react';

import PedidosCajeroScreen from '../app/(cajero)/index';
import EscanerQRScreen from '../app/(cajero)/escaner';
import ConfirmacionEntregaScreen from '../app/(cajero)/confirmacion-entrega';
import NoRetiradosScreen from '../app/(cajero)/no-retirados';
import {
  fetchPedidosEntrantes,
  marcarOrdenEntregada,
  resolverOrdenNoRetirada,
} from '../services/ordenes';
import { getAccessToken } from '../services/httpClient';
import { serializarQrRetiro } from '../services/qrRetiro';
import { useOrdenEstado } from '../hooks/useOrdenEstado';
import { useIsFocused } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import type { Orden } from '../types/domain';

// Pruebas end-to-end del flujo completo del cajero (INT4-13). Recorren el
// recorrido real que hace la cajera sobre su aplicación, encadenando las
// pantallas que ya tienen pruebas unitarias por separado (listado INT4-7,
// escaneo INT4-8, confirmación INT4-9, búsqueda manual INT4-10, no retirados
// INT4-11/INT4-12) sobre un único "backend simulado":
//
//   listado → (escanear QR | folio manual) → confirmación de entrega → no retirados
//
// Los servicios de órdenes se mockean pero mantienen un estado en memoria
// (backend de prueba): así se puede verificar que cada paso del flujo deja el
// sistema consistente, no solo que la pantalla reacciona. La navegación entre
// pantallas se simula con los mocks de expo-router: el router.replace captura
// la ruta destino y el test sigue el recorrido renderizando la pantalla
// siguiente con los params que expo-router le habría pasado.
const mockReplace = jest.fn();
const mockParams: Record<string, string | string[]> = {};

jest.mock('../services/ordenes', () => ({
  fetchPedidosEntrantes: jest.fn(),
  marcarOrdenEntregada: jest.fn(),
  resolverOrdenNoRetirada: jest.fn(),
}));

jest.mock('../services/httpClient', () => {
  const actual = jest.requireActual('../services/httpClient');
  return { ...actual, getAccessToken: jest.fn() };
});

jest.mock('../hooks/useOrdenEstado', () => ({
  useOrdenEstado: jest.fn(() => null),
}));

jest.mock('expo-router', () => ({
  useIsFocused: jest.fn(() => true),
  useRouter: jest.fn(() => ({ replace: mockReplace })),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(() => mockParams),
}));

// expo-camera es un módulo nativo: en los tests se reemplaza por un View que
// expone onBarcodeScanned para simular un escaneo, y el permiso queda mockeado.
jest.mock('expo-camera', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    useCameraPermissions: jest.fn(),
    CameraView: (props: {
      testID?: string;
      onBarcodeScanned?: (resultado: { data: string }) => void;
      barcodeScannerSettings?: { barcodeTypes: string[] };
    }) =>
      React.createElement(View, {
        testID: props.testID ?? 'cajero-camara',
        onBarcodeScanned: props.onBarcodeScanned,
        barcodeScannerSettings: props.barcodeScannerSettings,
      }),
  };
});

const mockGetAccessToken = getAccessToken as unknown as jest.Mock;
const mockFetchPedidos = fetchPedidosEntrantes as unknown as jest.Mock;
const mockMarcarEntregada = marcarOrdenEntregada as unknown as jest.Mock;
const mockResolver = resolverOrdenNoRetirada as unknown as jest.Mock;
const mockUseOrdenEstado = useOrdenEstado as unknown as jest.Mock;
const mockUseIsFocused = useIsFocused as unknown as jest.Mock;
const mockUseCameraPermissions = useCameraPermissions as unknown as jest.Mock;

// --- Backend simulado compartido por todo el flujo ---
// Mezcla de estados del union EstadoOrden igual a la que vería el cajero:
// o-1 lista para retiro (se entrega), o-2 no retirada pendiente de revisión
// (exige decidir sus 2 ítems), o-3 no retirada final (solo lectura).
const ordenEntregable: Orden = {
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
    {
      ordenItemId: 'itm-2',
      productoNombre: 'Croissant Jamón y Queso',
      cantidad: 1,
      precioUnitario: 2500,
    },
  ],
};

const ordenPendienteRevision: Orden = {
  ordenId: 'o-2',
  codigoOrden: 'CC-9802',
  cafeteriaId: 'c-1',
  cafeteriaNombre: 'Cafetería Central',
  clienteNombre: 'Diego Morales',
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

const ordenNoRetiradaFinal: Orden = {
  ordenId: 'o-3',
  codigoOrden: 'CC-9803',
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
};

let backend: Orden[] = [];

function reiniciarBackend(): void {
  backend = [ordenEntregable, ordenPendienteRevision, ordenNoRetiradaFinal];
}

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

function dataDe(tree: ReactTestRenderer): Orden[] {
  const lista = tree.root.findByType(FlatList);
  return lista.props.data as Orden[];
}

async function renderizar(pantalla: ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(pantalla);
    // Permite que resuelvan las promesas del fetch inicial dentro del act.
    await Promise.resolve();
  });
  return tree;
}

async function escanear(tree: ReactTestRenderer, contenido: string): Promise<void> {
  const camara = tree.root.findByProps({ testID: 'cajero-camara' });
  await act(async () => {
    camara.props.onBarcodeScanned({ data: contenido });
  });
}

describe('Flujo completo del cajero (INT4-13)', () => {
  beforeEach(() => {
    reiniciarBackend();

    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockReturnValue('token-real');

    mockFetchPedidos.mockReset();
    mockFetchPedidos.mockImplementation(async () => backend);

    // Las acciones del flujo mutan el backend simulado, igual que el servicio
    // real contra el backend: marcar como entregada y resolver la no retirada
    // cambian el estado persistido que ven las siguientes pantallas.
    mockMarcarEntregada.mockReset();
    mockMarcarEntregada.mockImplementation(async (ordenId: string) => {
      const orden = backend.find((o) => o.ordenId === ordenId);
      if (!orden) throw new Error(`Orden ${ordenId} no encontrada`);
      const entregada = { ...orden, estado: 'entregado' } as Orden;
      backend = backend.map((o) => (o.ordenId === ordenId ? entregada : o));
      return entregada;
    });

    mockResolver.mockReset();
    mockResolver.mockImplementation(async (ordenId: string) => {
      const orden = backend.find((o) => o.ordenId === ordenId);
      if (!orden) throw new Error(`Orden ${ordenId} no encontrada`);
      const resuelta = { ...orden, estado: 'no_retirado_final' } as Orden;
      backend = backend.map((o) => (o.ordenId === ordenId ? resuelta : o));
      return resuelta;
    });

    mockUseOrdenEstado.mockReset();
    mockUseOrdenEstado.mockReturnValue(null);

    mockUseIsFocused.mockReset();
    mockUseIsFocused.mockReturnValue(true);

    mockUseCameraPermissions.mockReset();
    mockUseCameraPermissions.mockReturnValue([{ granted: true }, jest.fn()]);

    mockReplace.mockClear();
    delete mockParams.pedido;
    delete mockParams.estado;
  });

  it('listado → búsqueda manual por folio → confirmación → entrega de la orden', async () => {
    const listado = await renderizar(<PedidosCajeroScreen />);

    // Listado (INT4-7): por defecto se ven solo los pedidos activos.
    expect(dataDe(listado).map((o) => o.ordenId)).toEqual(['o-1']);
    listado.root.findByProps({ testID: 'cajero-orden-o-1' });

    // Búsqueda manual por folio (INT4-10): respaldo ante fallas del escáner.
    const input = listado.root.findByProps({ testID: 'cajero-folio-input' });
    await act(async () => {
      input.props.onChangeText('cc-9801');
    });
    const validar = listado.root.findByProps({ testID: 'cajero-folio-validar' });
    await act(async () => {
      validar.props.onPress();
    });

    // Navega a la confirmación con el estado de la orden encontrada.
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(cajero)/confirmacion-entrega',
      params: { pedido: 'o-1', estado: 'listo_para_retiro' },
    });
    act(() => listado.unmount());

    // La pantalla siguiente recibe los params que expo-router le habría pasado.
    mockParams.pedido = 'o-1';
    mockParams.estado = 'listo_para_retiro';
    const confirmacion = await renderizar(<ConfirmacionEntregaScreen />);

    // Confirmación (INT4-9): detalle con cliente e ítems de la orden.
    const detalle = confirmacion.root.findByProps({ testID: 'cajero-confirmacion-detalle' });
    expect(textoDe(detalle)).toContain('Ignacio Soto');
    expect(textoDe(detalle)).toContain('Café Americano 12oz');
    expect(textoDe(detalle)).toContain('Croissant Jamón y Queso');

    const confirmar = confirmacion.root.findByProps({ testID: 'cajero-confirmacion-confirmar' });
    await act(async () => {
      confirmar.props.onPress();
    });

    // Entrega: la orden queda marcada y el backend simulado queda consistente.
    expect(mockMarcarEntregada).toHaveBeenCalledWith('o-1', 'token-real');
    confirmacion.root.findByProps({ testID: 'cajero-confirmacion-entregada' });
    expect(backend.find((o) => o.ordenId === 'o-1')?.estado).toBe('entregado');

    act(() => confirmacion.unmount());
  }, 20000);

  it('escaneo de QR → confirmación → entrega de la orden', async () => {
    const escaner = await renderizar(<EscanerQRScreen />);

    // Escaneo (INT4-8): un QR de retiro válido (serializado con el mismo
    // helper que usa el cliente) se valida y navega a la confirmación.
    await escanear(escaner, serializarQrRetiro({ pedido: 'o-1', estado: 'listo_para_retiro' }));

    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(cajero)/confirmacion-entrega',
      params: { pedido: 'o-1', estado: 'listo_para_retiro' },
    });
    act(() => escaner.unmount());

    mockParams.pedido = 'o-1';
    mockParams.estado = 'listo_para_retiro';
    const confirmacion = await renderizar(<ConfirmacionEntregaScreen />);

    const confirmar = confirmacion.root.findByProps({ testID: 'cajero-confirmacion-confirmar' });
    await act(async () => {
      confirmar.props.onPress();
    });

    expect(mockMarcarEntregada).toHaveBeenCalledWith('o-1', 'token-real');
    confirmacion.root.findByProps({ testID: 'cajero-confirmacion-entregada' });
    expect(backend.find((o) => o.ordenId === 'o-1')?.estado).toBe('entregado');

    act(() => confirmacion.unmount());
  }, 20000);

  it('listado no retirados → decisión ítem por ítem → resolución de la orden', async () => {
    const listado = await renderizar(<PedidosCajeroScreen />);

    // El filtro "No retirados" del listado deja ver solo esas órdenes del
    // union EstadoOrden (INT4-11), antes de pasar a la pestaña dedicada.
    const chipNoRetirados = listado.root.findByProps({ testID: 'cajero-filtro-no-retirados' });
    await act(async () => {
      chipNoRetirados.props.onPress();
    });
    expect(dataDe(listado).map((o) => o.ordenId)).toEqual(['o-2', 'o-3']);
    act(() => listado.unmount());

    // Pestaña No Retirados: listado + decisión ítem por ítem (INT4-11/INT4-12).
    const noRetirados = await renderizar(<NoRetiradosScreen />);
    expect(dataDe(noRetirados).map((o) => o.ordenId)).toEqual(['o-2', 'o-3']);

    // La orden final (o-3) es solo lectura; la pendiente (o-2) exige decidir
    // ítem por ítem: Té Chai Latte se reingresa, Brownie se descarta.
    const btnReingresar = noRetirados.root.findByProps({
      testID: 'cajero-nr-accion-itm-5-reingresar',
    });
    await act(async () => {
      btnReingresar.props.onPress();
    });
    const btnDescartar = noRetirados.root.findByProps({
      testID: 'cajero-nr-accion-itm-6-descartar',
    });
    await act(async () => {
      btnDescartar.props.onPress();
    });

    const confirmar = noRetirados.root.findByProps({ testID: 'cajero-nr-confirmar-o-2' });
    await act(async () => {
      confirmar.props.onPress();
    });

    // Resolución: la decisión por ítem llega al servicio con el token real.
    expect(mockResolver).toHaveBeenCalledWith(
      'o-2',
      [
        { ordenItemId: 'itm-5', accion: 'reingresar' },
        { ordenItemId: 'itm-6', accion: 'descartar' },
      ],
      'token-real'
    );

    // Éxito: resumen visible, la orden sale del listado y el backend queda
    // consistente (pasó de pendiente de revisión a final).
    const exito = noRetirados.root.findByProps({ testID: 'cajero-nr-exito' });
    expect(textoDe(exito)).toContain('1 ítem(s) reingresado(s) al stock, 1 descartado(s)');
    expect(dataDe(noRetirados).map((o) => o.ordenId)).toEqual(['o-3']);
    expect(backend.find((o) => o.ordenId === 'o-2')?.estado).toBe('no_retirado_final');

    act(() => noRetirados.unmount());
  }, 20000);
});
