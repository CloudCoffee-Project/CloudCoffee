// src/services/ordenes.test.ts
import { httpClient } from './httpClient';
import {
  fetchPedidosEntrantes,
  marcarOrdenEntregada,
  ORDENES_ENDPOINT,
  resolverOrdenNoRetirada,
} from './ordenes';
import type { Orden } from '../types/domain';

jest.mock('./httpClient', () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

const mockedGet = httpClient.get as unknown as jest.Mock;
const mockedPost = httpClient.post as unknown as jest.Mock;

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

describe('fetchPedidosEntrantes', () => {
  afterEach(() => {
    mockedGet.mockReset();
  });

  it('consulta el endpoint de órdenes del gateway con el token real', async () => {
    mockedGet.mockResolvedValue({ data: ordenesMock });

    const resultado = await fetchPedidosEntrantes('token-real');

    expect(mockedGet).toHaveBeenCalledWith(ORDENES_ENDPOINT, {
      headers: { Authorization: 'Bearer token-real' },
    });
    expect(resultado).toEqual(ordenesMock);
  });

  it('no inventa estados: la lista tipada usa el union EstadoOrden', async () => {
    mockedGet.mockResolvedValue({ data: ordenesMock });

    const resultado = await fetchPedidosEntrantes('token-real');

    expect(resultado[0].estado).toMatch(
      /^(reservando|pagado|listo_para_retiro|no_retirado_pendiente_revision|entregado|no_retirado_final|cancelado)$/
    );
  });
});

describe('marcarOrdenEntregada', () => {
  afterEach(() => {
    mockedPost.mockReset();
  });

  it('marca la orden como entregada en el endpoint del gateway', async () => {
    mockedPost.mockResolvedValue({ data: ordenesMock[0] });

    const resultado = await marcarOrdenEntregada('o-1', 'token-real');

    expect(mockedPost).toHaveBeenCalledWith(`${ORDENES_ENDPOINT}/o-1/entregar`, undefined, {
      headers: { Authorization: 'Bearer token-real' },
    });
    expect(resultado).toEqual(ordenesMock[0]);
  });
});

describe('resolverOrdenNoRetirada', () => {
  afterEach(() => {
    mockedPost.mockReset();
  });

  it('envía la decisión ítem por ítem al endpoint de revisión de la orden', async () => {
    const resuelta = { ...ordenesMock[0], estado: 'no_retirado_final' as const };
    mockedPost.mockResolvedValue({ data: resuelta });

    const decisiones = [{ ordenItemId: 'itm-1', accion: 'descartar' as const }];
    const resultado = await resolverOrdenNoRetirada('o-1', decisiones, 'token-real');

    expect(mockedPost).toHaveBeenCalledWith(
      `${ORDENES_ENDPOINT}/o-1/no-retirado/revisar`,
      { items: decisiones },
      { headers: { Authorization: 'Bearer token-real' } }
    );
    expect(resultado).toEqual(resuelta);
  });
});
