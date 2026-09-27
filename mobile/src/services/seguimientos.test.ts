// src/services/seguimientos.test.ts
import { eliminarSeguimiento, listarSeguimientos, SEGUIMIENTOS_ENDPOINT } from './seguimientos';
import { httpClient } from './httpClient';
import type { Seguimiento } from '../types/domain';

const seguimientoMock: Seguimiento = {
  id: 'seg-1',
  productoId: 'prod-1',
  productoNombre: 'Café de especialidad',
  cafeteriaId: null,
};

describe('listarSeguimientos', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/catalog/seguimientos y devuelve la lista', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({
      data: [seguimientoMock],
    });

    const resultado = await listarSeguimientos();

    expect(getSpy).toHaveBeenCalledWith(SEGUIMIENTOS_ENDPOINT);
    expect(resultado).toEqual([seguimientoMock]);
  });
});

describe('eliminarSeguimiento', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a DELETE /v1/catalog/seguimientos/{id}', async () => {
    const deleteSpy = jest.spyOn(httpClient, 'delete').mockResolvedValue({ data: null });

    await eliminarSeguimiento('seg-1');

    expect(deleteSpy).toHaveBeenCalledWith(`${SEGUIMIENTOS_ENDPOINT}/seg-1`);
  });
});
