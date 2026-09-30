// src/services/compras.test.ts
import { cancelarCompra, COMPRAS_ENDPOINT, confirmarCompra, listarCompras } from './compras';
import { httpClient } from './httpClient';
import type { Compra } from '../types/domain';

const compraMock: Compra = {
  compraId: 'compra-1',
  montoTotal: 4300,
  estado: 'pagado',
  ordenes: [
    {
      ordenId: 'orden-1',
      codigoOrden: 'ORD-1',
      cafeteriaId: 'caf-1',
      cafeteriaNombre: 'Cafetería Central',
      estado: 'entregado',
      montoTotal: 4300,
      items: [],
    },
  ],
};

describe('listarCompras', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/compras y devuelve el historial del cliente', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({
      data: [compraMock],
    });

    const resultado = await listarCompras();

    expect(getSpy).toHaveBeenCalledWith(COMPRAS_ENDPOINT);
    expect(resultado).toEqual([compraMock]);
  });

  it('propaga el error si el gateway responde con problem+json', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('Servicio no disponible'));

    await expect(listarCompras()).rejects.toThrow('Servicio no disponible');
  });
});

// INT4-37: confirmar o cancelar la compra completa (no una orden suelta).
describe('confirmarCompra y cancelarCompra', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('confirma la compra completa contra el endpoint de la compra', async () => {
    const confirmada = { ...compraMock, estado: 'pendiente_pago' as const };
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: confirmada });

    const resultado = await confirmarCompra('compra-1');

    expect(postSpy).toHaveBeenCalledWith(`${COMPRAS_ENDPOINT}/compra-1/confirmar`);
    expect(resultado).toEqual(confirmada);
  });

  it('cancela la compra completa contra el endpoint de la compra', async () => {
    const cancelada = { ...compraMock, estado: 'cancelado' as const };
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: cancelada });

    const resultado = await cancelarCompra('compra-1');

    expect(postSpy).toHaveBeenCalledWith(`${COMPRAS_ENDPOINT}/compra-1/cancelar`);
    expect(resultado).toEqual(cancelada);
  });

  it('propaga el error si el gateway rechaza la acción', async () => {
    jest.spyOn(httpClient, 'post').mockRejectedValue(new Error('La compra ya fue pagada'));

    await expect(cancelarCompra('compra-1')).rejects.toThrow('La compra ya fue pagada');
  });
});
