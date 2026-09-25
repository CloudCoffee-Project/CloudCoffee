// src/services/compras.test.ts
import { COMPRAS_ENDPOINT, listarCompras } from './compras';
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
