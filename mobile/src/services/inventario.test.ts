// src/services/inventario.test.ts
import { httpClient } from './httpClient';
import { CAMPUS_ENDPOINT } from './catalog';
import {
  INVENTARIO_ENDPOINT,
  inventarioEndpoint,
  listarInventarioCafeteria,
  mapearInventarioItem,
  obtenerNombreCafeteria,
} from './inventario';

// catalog.ts importa AsyncStorage para la persistencia del campus; Jest no
// tiene el módulo nativo, así que se reemplaza por el doble compartido.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

const cafeteriaId = '44444444-4444-4444-8444-444444444444';

// CafeteriaInventoryItemResponse tal como lo devuelve el catalog-service.
const inventarioDto = [
  {
    id: 'of-1',
    productoId: 'prod-1',
    productoNombre: 'Café americano',
    precio: 1500,
    stock: 40,
    estado: 'AVAILABLE',
  },
  {
    id: 'of-2',
    productoId: 'prod-2',
    productoNombre: 'Latte de vainilla',
    // BigDecimal serializado como string: el servicio lo normaliza a number.
    precio: '2600.00',
    stock: 0,
    estado: 'AVAILABLE',
  },
  {
    id: 'of-3',
    productoId: 'prod-3',
    productoNombre: 'Agua mineral',
    precio: 1000,
    stock: 0,
    estado: 'OUT_OF_STOCK',
  },
];

describe('inventarioEndpoint', () => {
  it('arma la ruta del inventario dentro del gateway', () => {
    expect(INVENTARIO_ENDPOINT).toBe('/v1/catalog/cafeterias');
    expect(inventarioEndpoint(cafeteriaId)).toBe(`/v1/catalog/cafeterias/${cafeteriaId}/ofertas`);
  });
});

describe('mapearInventarioItem', () => {
  it('traduce el DTO del backend al dominio', () => {
    expect(mapearInventarioItem(inventarioDto[0])).toEqual({
      ofertaId: 'of-1',
      productoId: 'prod-1',
      productoNombre: 'Café americano',
      precio: 1500,
      stock: 40,
      estado: 'AVAILABLE',
    });
  });

  it('normaliza el precio en string y conserva las agotadas', () => {
    expect(mapearInventarioItem(inventarioDto[1]).precio).toBe(2600);
    expect(mapearInventarioItem(inventarioDto[2]).estado).toBe('OUT_OF_STOCK');
  });

  it('trata un estado desconocido como disponible (la agotada se decide por stock)', () => {
    expect(mapearInventarioItem({ ...inventarioDto[0], estado: 'PAUSED' }).estado).toBe(
      'AVAILABLE'
    );
  });
});

describe('listarInventarioCafeteria', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('llama a la ruta de personal y devuelve todas las ofertas, agotadas incluidas', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: inventarioDto });

    const resultado = await listarInventarioCafeteria(cafeteriaId);

    expect(getSpy).toHaveBeenCalledWith(inventarioEndpoint(cafeteriaId));
    expect(resultado).toHaveLength(3);
    expect(resultado.map((item) => item.ofertaId)).toEqual(['of-1', 'of-2', 'of-3']);
  });

  it('propaga el error del gateway', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('403 Forbidden'));

    await expect(listarInventarioCafeteria(cafeteriaId)).rejects.toThrow('403 Forbidden');
  });
});

describe('obtenerNombreCafeteria', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resuelve el nombre desde las cafeterías de GET /v1/catalog/campus', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({
      data: [
        {
          id: 'campus-1',
          nombre: 'Campus San Francisco',
          direccion: 'Manuel Montt 056, Temuco',
          cafeterias: [
            { id: 'otra', nombre: 'Cafetería Norte' },
            { id: cafeteriaId, nombre: 'Cafetería Central' },
          ],
        },
      ],
    });

    await expect(obtenerNombreCafeteria(cafeteriaId)).resolves.toBe('Cafetería Central');
    expect(getSpy).toHaveBeenCalledWith(CAMPUS_ENDPOINT);
  });

  it('devuelve null si la cafetería no está en el catálogo', async () => {
    jest.spyOn(httpClient, 'get').mockResolvedValue({ data: [] });

    await expect(obtenerNombreCafeteria(cafeteriaId)).resolves.toBeNull();
  });

  it('devuelve null en vez de romper la pantalla si el catálogo falla', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('Catálogo no disponible'));

    await expect(obtenerNombreCafeteria(cafeteriaId)).resolves.toBeNull();
  });
});
