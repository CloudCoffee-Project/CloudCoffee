// src/services/boletas.test.ts
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';

import { httpClient } from './httpClient';
import { ORDENES_ENDPOINT } from './ordenes';
import { compartirBoleta, descargarBoleta, guardarBoletaPdf } from './boletas';

// expo-file-system (API nueva de SDK 57: File/Paths) depende de módulos
// nativos; se mockea la superficie que usa el servicio para aislar el test.
// File se expone como jest.fn que construye ArchivoFalso (permite usar
// mockImplementationOnce para simular un archivo que ya existía). Las
// variables usadas dentro del factory llevan prefijo "mock" (regla de Jest).
const mockArchivosCreados: mockArchivoFalso[] = [];

class mockArchivoFalso {
  exists = false;
  uri: string;
  escrito: Uint8Array | null = null;
  borrado = false;

  constructor(...segmentos: (string | { uri: string })[]) {
    const partes = segmentos.map((s) => (typeof s === 'string' ? s : s.uri));
    this.uri = partes.join('/');
    this.exists = false;
    mockArchivosCreados.push(this);
  }

  create(): void {
    this.exists = true;
  }

  delete(): void {
    this.exists = false;
    this.borrado = true;
  }

  write(contenido: Uint8Array): void {
    this.escrito = contenido;
  }
}

jest.mock('expo-file-system', () => ({
  File: jest.fn((...segmentos: (string | { uri: string })[]) => new mockArchivoFalso(...segmentos)),
  Paths: { document: { uri: 'file:///documentos' }, cache: { uri: 'file:///cache' } },
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

const shareAsyncMock = Sharing.shareAsync as unknown as jest.Mock;
const isAvailableMock = Sharing.isAvailableAsync as unknown as jest.Mock;

const bytesDePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

describe('descargarBoleta', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/orders/{id}/boleta en modo binario y devuelve los bytes', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({
      data: bytesDePdf.buffer as ArrayBuffer,
    } as never);

    const resultado = await descargarBoleta('orden-1');

    expect(getSpy).toHaveBeenCalledWith(`${ORDENES_ENDPOINT}/orden-1/boleta`, {
      responseType: 'arraybuffer',
    });
    expect(resultado).toEqual(bytesDePdf);
  });

  it('normaliza el problem+json binario de un error del gateway (RFC 9457)', async () => {
    const problemJson = JSON.stringify({ detail: 'La orden aún no está pagada' });
    const getSpy = jest.spyOn(httpClient, 'get').mockRejectedValue({
      response: {
        status: 409,
        data: new TextEncoder().encode(problemJson).buffer as ArrayBuffer,
      },
    } as never);

    await expect(descargarBoleta('orden-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'La orden aún no está pagada',
    });
    expect(getSpy).toHaveBeenCalled();
  });

  it('mantiene el texto del body si el error no trae un problem+json válido', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockRejectedValue({
      response: { status: 502, data: new TextEncoder().encode('<html>ups</html>').buffer },
    } as never);

    await expect(descargarBoleta('orden-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      message: '<html>ups</html>',
    });
    expect(getSpy).toHaveBeenCalled();
  });

  it('delega en toApiError sin respuesta HTTP (red caída)', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockRejectedValue({
      message: 'Network Error',
      response: undefined,
    } as never);

    await expect(descargarBoleta('orden-1')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Network Error',
    });
    expect(getSpy).toHaveBeenCalled();
  });
});

describe('guardarBoletaPdf', () => {
  beforeEach(() => {
    mockArchivosCreados.length = 0;
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('escribe el PDF en documentos con nombre boleta-<orden>.pdf', () => {
    const uri = guardarBoletaPdf('orden-1', bytesDePdf);

    expect(uri).toBe('file:///documentos/boleta-orden-1.pdf');
    expect(mockArchivosCreados).toHaveLength(1);
    const archivo = mockArchivosCreados[0];
    expect(archivo.exists).toBe(true);
    expect(archivo.escrito).toEqual(bytesDePdf);
  });

  it('reemplaza una boleta previa de la misma orden en vez de acumular copias', () => {
    const archivoPrevio = new mockArchivoFalso('file:///documentos', 'boleta-orden-1.pdf');
    archivoPrevio.create();
    mockArchivosCreados.pop(); // el constructor ya lo registró; lo controlamos a mano
    (File as unknown as jest.Mock).mockImplementationOnce(() => archivoPrevio);

    guardarBoletaPdf('orden-1', bytesDePdf);

    expect(archivoPrevio.borrado).toBe(true);
    expect(archivoPrevio.exists).toBe(true);
    expect(archivoPrevio.escrito).toEqual(bytesDePdf);
  });
});

describe('compartirBoleta', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('abre el share sheet con mimeType PDF y devuelve true', async () => {
    isAvailableMock.mockResolvedValue(true);

    await expect(compartirBoleta('file:///documentos/boleta-orden-1.pdf')).resolves.toBe(true);

    expect(shareAsyncMock).toHaveBeenCalledWith('file:///documentos/boleta-orden-1.pdf', {
      mimeType: 'application/pdf',
      dialogTitle: 'Boleta de tu orden',
      UTI: 'com.adobe.pdf',
    });
  });

  it('devuelve false y no abre el share sheet si el dispositivo no lo soporta', async () => {
    isAvailableMock.mockResolvedValue(false);

    await expect(compartirBoleta('file:///documentos/boleta-orden-1.pdf')).resolves.toBe(false);
    expect(shareAsyncMock).not.toHaveBeenCalled();
  });
});
