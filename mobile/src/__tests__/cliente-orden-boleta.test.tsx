// src/__tests__/cliente-orden-boleta.test.tsx
import { act, create } from 'react-test-renderer';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

import DetalleOrdenScreen from '../app/(cliente)/orden/[id]';
import { useLocalSearchParams } from 'expo-router';
import { descargarBoleta, guardarBoletaPdf, compartirBoleta } from '../services/boletas';
import { ApiError } from '../services/httpClient';

jest.mock('../services/boletas', () => ({
  descargarBoleta: jest.fn(),
  guardarBoletaPdf: jest.fn(),
  compartirBoleta: jest.fn(),
}));

const mockRouter = { back: jest.fn(), push: jest.fn() };

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({ id: 'orden-1' })),
  useRouter: jest.fn(() => mockRouter),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

const mockUseLocalSearchParams = useLocalSearchParams as unknown as jest.Mock;
const mockDescargarBoleta = descargarBoleta as unknown as jest.Mock;
const mockGuardarBoletaPdf = guardarBoletaPdf as unknown as jest.Mock;
const mockCompartirBoleta = compartirBoleta as unknown as jest.Mock;

const bytesDePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

function textoDe(nodo: ReactTestInstance): string {
  return nodo.children
    .map((hijo) => (typeof hijo === 'string' ? hijo : textoDe(hijo as ReactTestInstance)))
    .join('');
}

async function renderizarPantalla(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<DetalleOrdenScreen />);
  });
  return tree;
}

beforeEach(() => {
  mockUseLocalSearchParams.mockReturnValue({ id: 'orden-1' });
  mockDescargarBoleta.mockReset();
  mockGuardarBoletaPdf.mockReset();
  mockCompartirBoleta.mockReset();
});

describe('pantalla de detalle de orden (boleta)', () => {
  it('muestra el número de pedido recibido por params', async () => {
    const tree = await renderizarPantalla();

    expect(textoDe(tree.root)).toContain('#orden-1');
    expect(textoDe(tree.root)).toContain('Descargar Boleta (PDF)');

    act(() => tree.unmount());
  });

  it('muestra el estado vacío si no llega el id de la orden', async () => {
    mockUseLocalSearchParams.mockReturnValue({});

    const tree = await renderizarPantalla();

    expect(textoDe(tree.root)).toContain('No hay una orden seleccionada');

    act(() => tree.unmount());
  });

  it('descarga, guarda y comparte el PDF al presionar el botón', async () => {
    mockDescargarBoleta.mockResolvedValue(bytesDePdf);
    mockGuardarBoletaPdf.mockReturnValue('file:///documentos/boleta-orden-1.pdf');
    mockCompartirBoleta.mockResolvedValue(true);

    const tree = await renderizarPantalla();

    const boton = tree.root.findByProps({ testID: 'descargar-boleta' });
    await act(async () => {
      boton.props.onPress();
    });
    await act(async () => {});

    expect(mockDescargarBoleta).toHaveBeenCalledWith('orden-1');
    expect(mockGuardarBoletaPdf).toHaveBeenCalledWith('orden-1', bytesDePdf);
    expect(mockCompartirBoleta).toHaveBeenCalledWith('file:///documentos/boleta-orden-1.pdf');

    const exito = tree.root.findByProps({ testID: 'boleta-exito' });
    expect(textoDe(exito)).toContain('lista para guardar o abrir');

    act(() => tree.unmount());
  });

  it('informa que el PDF quedó guardado si el dispositivo no permite compartir', async () => {
    mockDescargarBoleta.mockResolvedValue(bytesDePdf);
    mockGuardarBoletaPdf.mockReturnValue('file:///documentos/boleta-orden-1.pdf');
    mockCompartirBoleta.mockResolvedValue(false);

    const tree = await renderizarPantalla();

    const boton = tree.root.findByProps({ testID: 'descargar-boleta' });
    await act(async () => {
      boton.props.onPress();
    });
    await act(async () => {});

    const exito = tree.root.findByProps({ testID: 'boleta-exito' });
    expect(textoDe(exito)).toContain('guardada en el dispositivo');

    act(() => tree.unmount());
  });

  it('muestra el estado de descarga mientras resuelve la petición', async () => {
    let resolverDescarga!: (bytes: Uint8Array) => void;
    mockDescargarBoleta.mockImplementation(
      () => new Promise<Uint8Array>((resolve) => (resolverDescarga = resolve))
    );

    const tree = await renderizarPantalla();

    const boton = tree.root.findByProps({ testID: 'descargar-boleta' });
    await act(async () => {
      boton.props.onPress();
    });

    expect(textoDe(tree.root)).toContain('Descargando boleta…');

    await act(async () => {
      resolverDescarga(bytesDePdf);
    });
    await act(async () => {});

    act(() => tree.unmount());
  });

  it('muestra el error normalizado si el gateway responde con problem+json', async () => {
    mockDescargarBoleta.mockRejectedValue(new ApiError('La orden aún no está pagada', 409));

    const tree = await renderizarPantalla();

    const boton = tree.root.findByProps({ testID: 'descargar-boleta' });
    await act(async () => {
      boton.props.onPress();
    });
    await act(async () => {});

    const banner = tree.root.findByProps({ testID: 'boleta-error' });
    expect(textoDe(banner)).toContain('La orden aún no está pagada');

    act(() => tree.unmount());
  });

  it('vuelve a la pantalla anterior con el botón Volver', async () => {
    const tree = await renderizarPantalla();

    const volver = tree.root.findByProps({ testID: 'volver-boleta' });
    await act(async () => {
      volver.props.onPress();
    });

    expect(mockRouter.back).toHaveBeenCalled();

    act(() => tree.unmount());
  });
});
