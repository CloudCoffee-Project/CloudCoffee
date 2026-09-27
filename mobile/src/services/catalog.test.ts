// src/services/catalog.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CAMPUS_ENDPOINT,
  CATEGORIAS_ENDPOINT,
  PRODUCTOS_ENDPOINT,
  guardarCampusSeleccionado,
  leerCampusSeleccionado,
  limpiarCampusSeleccionado,
  listarCampus,
  listarCategorias,
  listarProductos,
  obtenerProducto,
} from './catalog';
// La clave se importa del módulo canónico: si las pantallas la redefinieran,
// estas aserciones fallarían porque la escritura usaría otra clave.
import { CAMPUS_STORAGE_KEY } from './campus';
import { httpClient } from './httpClient';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

// AsyncStorage no existe como módulo nativo en Jest; se mockea su superficie.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockGetItem = AsyncStorage.getItem as unknown as jest.Mock;
const mockSetItem = AsyncStorage.setItem as unknown as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as unknown as jest.Mock;

const campusMock: Campus = {
  id: 'campus-1',
  nombre: 'Campus San Francisco',
  direccion: 'Manuel Montt 056, Temuco',
};

const categoriaMock: Categoria = { id: 'cat-1', nombre: 'Bebidas' };

const ofertaMock: Oferta = {
  ofertaId: 'oferta-1',
  cafeteriaId: 'cafe-1',
  cafeteriaNombre: 'Cafetería Central',
  precio: 1800,
  stock: 4,
  disponible: true,
};

const productoMock: Producto = {
  id: 'prod-1',
  nombre: 'Café Americano 12oz',
  descripcion: 'Espresso doble con agua caliente.',
  categoriaId: 'cat-1',
  offers: [ofertaMock],
};

describe('listarCampus', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/catalog/campus y devuelve los campus', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: [campusMock] });

    const resultado = await listarCampus();

    expect(getSpy).toHaveBeenCalledWith(CAMPUS_ENDPOINT);
    expect(resultado).toEqual([campusMock]);
  });

  it('propaga el error si el gateway responde con problem+json', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('Catálogo no disponible'));

    await expect(listarCampus()).rejects.toThrow('Catálogo no disponible');
  });
});

describe('listarCategorias', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/catalog/categorias y devuelve las categorías', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: [categoriaMock] });

    const resultado = await listarCategorias();

    expect(getSpy).toHaveBeenCalledWith(CATEGORIAS_ENDPOINT);
    expect(resultado).toEqual([categoriaMock]);
  });

  it('propaga el error si el gateway responde con problem+json', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('Sin categorías'));

    await expect(listarCategorias()).rejects.toThrow('Sin categorías');
  });
});

describe('listarProductos', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('envía solo el campus cuando no hay categoría seleccionada', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: [productoMock] });

    const resultado = await listarProductos('campus-1');

    expect(getSpy).toHaveBeenCalledWith(PRODUCTOS_ENDPOINT, { params: { campusId: 'campus-1' } });
    expect(resultado).toEqual([productoMock]);
  });

  it('envía campus y categoría cuando se filtra por categoría', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: [productoMock] });

    await listarProductos('campus-1', 'cat-1');

    expect(getSpy).toHaveBeenCalledWith(PRODUCTOS_ENDPOINT, {
      params: { campusId: 'campus-1', categoriaId: 'cat-1' },
    });
  });
});

describe('obtenerProducto', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/catalog/productos/{id} con el campus activo', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: productoMock });

    const resultado = await obtenerProducto('prod-1', 'campus-1');

    expect(getSpy).toHaveBeenCalledWith(`${PRODUCTOS_ENDPOINT}/prod-1`, {
      params: { campusId: 'campus-1' },
    });
    expect(resultado).toEqual(productoMock);
  });

  it('propaga el error si el gateway responde con problem+json', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('Producto no encontrado'));

    await expect(obtenerProducto('prod-1', 'campus-1')).rejects.toThrow('Producto no encontrado');
  });
});

describe('persistencia del campus seleccionado', () => {
  beforeEach(() => {
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockRemoveItem.mockReset();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    mockRemoveItem.mockResolvedValue(undefined);
  });

  it('guarda el campus elegido bajo la clave canónica', async () => {
    await guardarCampusSeleccionado(campusMock);

    expect(mockSetItem).toHaveBeenCalledWith(CAMPUS_STORAGE_KEY, JSON.stringify(campusMock));
  });

  it('lee el campus guardado con id y nombre', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify(campusMock));

    const resultado = await leerCampusSeleccionado();

    expect(mockGetItem).toHaveBeenCalledWith(CAMPUS_STORAGE_KEY);
    expect(resultado).toEqual(campusMock);
  });

  it('completa la dirección ausente con cadena vacía', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ id: 'campus-1', nombre: 'Sede' }));

    expect(await leerCampusSeleccionado()).toEqual({
      id: 'campus-1',
      nombre: 'Sede',
      direccion: '',
      cafeterias: undefined,
    });
  });

  it('conserva la lista de cafeterías del campus al releerlo del almacén', async () => {
    const conCafeterias: Campus = {
      id: '9f3c1a2b-0000-4000-8000-000000000001',
      nombre: 'Campus San Francisco',
      direccion: 'Manuel Montt 056, Temuco',
      cafeterias: [
        { id: '7a1d0000-0000-4000-8000-000000000002', nombre: 'Cafetería Central' },
        { id: '7a1d0000-0000-4000-8000-000000000003', nombre: 'Cafetería Norte' },
      ],
    };
    mockGetItem.mockResolvedValueOnce(JSON.stringify(conCafeterias));

    expect(await leerCampusSeleccionado()).toEqual(conCafeterias);
  });

  it('descarta cafeterías que no vengan en forma de lista', async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ id: 'campus-1', nombre: 'Sede', cafeterias: 'no-es-lista' })
    );

    expect(await leerCampusSeleccionado()).toHaveProperty('cafeterias', undefined);
  });

  it('descarta campos sueltos al releer el campus', async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({
        id: 'campus-1',
        nombre: 'Sede',
        direccion: 'Calle 1',
        hack: 'no-debe-pasarse',
      })
    );

    expect(await leerCampusSeleccionado()).not.toHaveProperty('hack');
  });

  it('devuelve null si no hay campus guardado', async () => {
    mockGetItem.mockResolvedValueOnce(null);

    expect(await leerCampusSeleccionado()).toBeNull();
  });

  it('devuelve null ante JSON corrupto en vez de propagar el error', async () => {
    mockGetItem.mockResolvedValueOnce('{no-es-json');

    expect(await leerCampusSeleccionado()).toBeNull();
  });

  it('devuelve null si falla la lectura del almacén', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('almacenamiento no disponible'));

    expect(await leerCampusSeleccionado()).toBeNull();
  });

  it('devuelve null si el objeto guardado no tiene id ni nombre', async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ direccion: 'sin id ni nombre' }));

    expect(await leerCampusSeleccionado()).toBeNull();
  });

  it('borra la selección guardada', async () => {
    await limpiarCampusSeleccionado();

    expect(mockRemoveItem).toHaveBeenCalledWith(CAMPUS_STORAGE_KEY);
  });
});
