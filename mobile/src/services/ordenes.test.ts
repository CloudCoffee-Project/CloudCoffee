// src/services/ordenes.test.ts
import { ApiError, httpClient } from './httpClient';
import {
  cancelarOrden,
  confirmarOrden,
  fetchPedidosEntrantes,
  marcarOrdenEntregada,
  ORDENES_ENDPOINT,
  ORDENES_TAMANO_PAGINA,
  resolverOrdenNoRetirada,
} from './ordenes';
import type { Orden, PaginaOrdenes } from '../types/domain';

jest.mock('./httpClient', () => {
  const actual = jest.requireActual('./httpClient');
  return {
    ...actual,
    httpClient: { get: jest.fn(), post: jest.fn() },
  };
});

const mockedGet = httpClient.get as unknown as jest.Mock;
const mockedPost = httpClient.post as unknown as jest.Mock;

// Token opaco del contrato: Base64URL de 43 caracteres.
const CODIGO_RETIRO = 'a'.repeat(43);

const ordenesMock: Orden[] = [
  {
    ordenId: 'o-1',
    codigoOrden: 'CC-9801',
    cafeteriaId: 'c-1',
    cafeteriaNombre: 'Cafetería Central',
    clienteNombre: 'Ignacio Soto',
    estado: 'pagado',
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
];

// Arma una PaginaOrdenes como la del contrato. Permite probar la navegación
// entre páginas sin repetir todos los campos de la envoltura.
function pagina(content: Orden[], overrides: Partial<PaginaOrdenes> = {}): PaginaOrdenes {
  return {
    content,
    number: 0,
    size: ORDENES_TAMANO_PAGINA,
    totalElements: content.length,
    totalPages: 1,
    first: true,
    last: true,
    empty: content.length === 0,
    ...overrides,
  };
}

describe('fetchPedidosEntrantes', () => {
  afterEach(() => {
    mockedGet.mockReset();
  });

  it('consulta la primera página del contrato con el token real y devuelve el content', async () => {
    mockedGet.mockResolvedValue({ data: pagina(ordenesMock) });

    const resultado = await fetchPedidosEntrantes('token-real');

    expect(mockedGet).toHaveBeenCalledWith(ORDENES_ENDPOINT, {
      params: { page: 0, size: ORDENES_TAMANO_PAGINA },
      headers: { Authorization: 'Bearer token-real' },
    });
    expect(resultado).toEqual(ordenesMock);
  });

  it('recorre todas las páginas hasta `last` y concatena sus órdenes', async () => {
    const segunda = { ...ordenesMock[0], ordenId: 'o-2', codigoOrden: 'CC-9802' };
    mockedGet
      .mockResolvedValueOnce({
        data: pagina([ordenesMock[0]], { totalPages: 2, last: false }),
      })
      .mockResolvedValueOnce({
        data: pagina([segunda], {
          number: 1,
          totalPages: 2,
          totalElements: 2,
          first: false,
        }),
      });

    const resultado = await fetchPedidosEntrantes('token-real');

    expect(resultado).toEqual([ordenesMock[0], segunda]);
    expect(mockedGet).toHaveBeenNthCalledWith(1, ORDENES_ENDPOINT, {
      params: { page: 0, size: ORDENES_TAMANO_PAGINA },
      headers: { Authorization: 'Bearer token-real' },
    });
    expect(mockedGet).toHaveBeenNthCalledWith(2, ORDENES_ENDPOINT, {
      params: { page: 1, size: ORDENES_TAMANO_PAGINA },
      headers: { Authorization: 'Bearer token-real' },
    });
  });

  it('se detiene en una página vacía aunque `last` no venga marcado', async () => {
    mockedGet.mockResolvedValue({ data: pagina([], { last: false }) });

    const resultado = await fetchPedidosEntrantes('token-real');

    expect(resultado).toEqual([]);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('no inventa estados: la lista tipada usa el union EstadoOrden', async () => {
    mockedGet.mockResolvedValue({ data: pagina(ordenesMock) });

    const resultado = await fetchPedidosEntrantes('token-real');

    expect(resultado[0].estado).toMatch(
      /^(revision_requerida|pendiente_pago|pagado|listo_para_retiro|entregado|no_retirado_pendiente_revision|no_retirado_final|cancelado)$/
    );
  });

  it('propaga el error si la ruta de órdenes no está disponible', async () => {
    mockedGet.mockRejectedValue(new Error('Request failed with status code 404'));

    await expect(fetchPedidosEntrantes('token-real')).rejects.toThrow('404');
  });
});

describe('marcarOrdenEntregada', () => {
  afterEach(() => {
    mockedPost.mockReset();
  });

  it('envía el código del contrato y una Idempotency-Key UUID al endpoint real', async () => {
    mockedPost.mockResolvedValue({ data: ordenesMock[0] });

    const resultado = await marcarOrdenEntregada('o-1', CODIGO_RETIRO, 'token-real', 'clave-fija');

    expect(mockedPost).toHaveBeenCalledWith(
      `${ORDENES_ENDPOINT}/o-1/entregar`,
      { codigo: CODIGO_RETIRO },
      {
        headers: {
          Authorization: 'Bearer token-real',
          'Idempotency-Key': 'clave-fija',
        },
      }
    );
    expect(resultado).toEqual(ordenesMock[0]);
  });

  it('genera una clave UUID cuando la pantalla no reutiliza ninguna', async () => {
    mockedPost.mockResolvedValue({ data: ordenesMock[0] });

    await marcarOrdenEntregada('o-1', CODIGO_RETIRO, 'token-real');

    const clave = mockedPost.mock.calls[0][2].headers['Idempotency-Key'];
    expect(clave).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('no llama al backend si el QR no trae el token del contrato', async () => {
    await expect(marcarOrdenEntregada('o-1', 'folio-no-token', 'token-real')).rejects.toMatchObject(
      {
        name: 'ApiError',
        status: 400,
        problem: { code: 'QR_INVALIDO' },
      }
    );
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('propaga el error normalizado del backend', async () => {
    const error = new ApiError('QR usado', 409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'QR usado',
      code: 'QR_UTILIZADO',
    });
    mockedPost.mockRejectedValue(error);

    await expect(marcarOrdenEntregada('o-1', CODIGO_RETIRO, 'token-real')).rejects.toBe(error);
  });
});

// INT4-37: acciones del cliente sobre una orden puntual de su compra.
describe('confirmarOrden y cancelarOrden', () => {
  afterEach(() => {
    mockedPost.mockReset();
  });

  it('confirma la orden en su propio endpoint, sin enviar token a mano', async () => {
    const confirmada = { ...ordenesMock[0], estado: 'pagado' as const };
    mockedPost.mockResolvedValue({ data: confirmada });

    const resultado = await confirmarOrden('o-1');

    expect(mockedPost).toHaveBeenCalledWith(
      `${ORDENES_ENDPOINT}/o-1/confirmar`,
      undefined,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      })
    );
    expect(resultado).toEqual(confirmada);
  });

  it('cancela la orden en su propio endpoint', async () => {
    const cancelada = { ...ordenesMock[0], estado: 'cancelado' as const };
    mockedPost.mockResolvedValue({ data: cancelada });

    const resultado = await cancelarOrden('o-1');

    expect(mockedPost).toHaveBeenCalledWith(
      `${ORDENES_ENDPOINT}/o-1/cancelar`,
      undefined,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      })
    );
    expect(resultado).toEqual(cancelada);
  });

  it('propaga el error si el gateway rechaza la acción', async () => {
    mockedPost.mockRejectedValue(new Error('La orden ya fue pagada'));

    await expect(confirmarOrden('o-1')).rejects.toThrow('La orden ya fue pagada');
  });
});

describe('resolverOrdenNoRetirada', () => {
  afterEach(() => {
    mockedPost.mockReset();
  });

  it('degrada con error normalizado: el backend no expone ruta de revisión', async () => {
    const decisiones = [{ ordenItemId: 'itm-1', accion: 'descartar' as const }];

    await expect(resolverOrdenNoRetirada('o-1', decisiones, 'token-real')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      problem: { code: 'RUTA_NO_DISPONIBLE' },
    });

    // No se dispara una petición a un endpoint inventado ni se simula éxito.
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
