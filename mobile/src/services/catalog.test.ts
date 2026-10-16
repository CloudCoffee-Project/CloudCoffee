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
  listarOfertasProducto,
  listarProductos,
  obtenerProducto,
  ordenarOfertasPorPrecio,
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

// DTOs tal como los devuelve el catalog-service: el producto sin ofertas (van en
// su propio endpoint) y con los nombres en inglés que usa ProductOfferResponse.
const productoDto = {
  id: 'prod-1',
  categoriaId: 'cat-1',
  nombre: 'Café Americano 12oz',
  descripcion: 'Espresso doble con agua caliente.',
  imagenUrl: null,
  estado: 'ACTIVE',
};

const ofertaDto = {
  id: 'oferta-1',
  cafeteriaId: 'cafe-1',
  cafeteriaName: 'Cafetería Central',
  price: 1800,
  stock: 4,
  disponible: true,
};

// El listado devuelve una Page de Spring Data, no un array: la parte que la app
// consume es `content`.
const paginaDeProductos = { content: [productoDto], totalElements: 1, number: 0, size: 100 };

// Reparte las respuestas por URL, como haría el gateway: el listado pide la
// página de productos y, por cada producto, sus ofertas.
function getPorRuta(respuestas: Record<string, unknown>): jest.SpyInstance {
  return jest.spyOn(httpClient, 'get').mockImplementation((async (url: string) => ({
    data: respuestas[url],
  })) as unknown as typeof httpClient.get);
}

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

  it('lee el contenido de la Page y le adjunta las ofertas del campus', async () => {
    getPorRuta({
      [PRODUCTOS_ENDPOINT]: paginaDeProductos,
      [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [ofertaDto],
    });

    const resultado = await listarProductos('campus-1');

    expect(resultado).toEqual([productoMock]);
  });

  it('envía solo el campus (con el tamaño de página) cuando no hay categoría', async () => {
    const getSpy = getPorRuta({
      [PRODUCTOS_ENDPOINT]: paginaDeProductos,
      [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [ofertaDto],
    });

    await listarProductos('campus-1');

    expect(getSpy).toHaveBeenCalledWith(PRODUCTOS_ENDPOINT, {
      params: { campusId: 'campus-1', size: 100 },
    });
  });

  it('envía campus y categoría cuando se filtra por categoría', async () => {
    const getSpy = getPorRuta({
      [PRODUCTOS_ENDPOINT]: paginaDeProductos,
      [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [ofertaDto],
    });

    await listarProductos('campus-1', 'cat-1');

    expect(getSpy).toHaveBeenCalledWith(PRODUCTOS_ENDPOINT, {
      params: { campusId: 'campus-1', categoriaId: 'cat-1', size: 100 },
    });
  });

  it('traduce el DTO de la oferta al tipo del dominio (price, cafeteriaName, id)', async () => {
    getPorRuta({
      [PRODUCTOS_ENDPOINT]: paginaDeProductos,
      [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [
        { ...ofertaDto, price: 1490.5, cafeteriaName: 'Cafetería Norte', disponible: false },
      ],
    });

    const [producto] = await listarProductos('campus-1');

    expect(producto.offers).toEqual([
      {
        ofertaId: 'oferta-1',
        cafeteriaId: 'cafe-1',
        cafeteriaNombre: 'Cafetería Norte',
        precio: 1490.5,
        stock: 4,
        disponible: false,
      },
    ]);
  });

  it('no deja pasar los campos que el dominio no tiene', async () => {
    getPorRuta({
      [PRODUCTOS_ENDPOINT]: paginaDeProductos,
      [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [ofertaDto],
    });

    const [producto] = await listarProductos('campus-1');

    expect(producto).not.toHaveProperty('imagenUrl');
    expect(producto).not.toHaveProperty('estado');
  });

  it('devuelve lista vacía si el campus no tiene productos', async () => {
    getPorRuta({ [PRODUCTOS_ENDPOINT]: { content: [] } });

    expect(await listarProductos('campus-1')).toEqual([]);
  });

  it('propaga el error si falla el listado', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('Catálogo no disponible'));

    await expect(listarProductos('campus-1')).rejects.toThrow('Catálogo no disponible');
  });

  it('propaga el error si falla la carga de ofertas de un producto', async () => {
    jest.spyOn(httpClient, 'get').mockImplementation((async (url: string) => {
      if (url === PRODUCTOS_ENDPOINT) {
        return { data: paginaDeProductos };
      }
      throw new Error('No pudimos leer las ofertas');
    }) as unknown as typeof httpClient.get);

    // Prefiere fallar antes que mostrar el producto sin precio, que se vería
    // como "Sin ofertas disponibles" y sería un dato falso.
    await expect(listarProductos('campus-1')).rejects.toThrow('No pudimos leer las ofertas');
  });
});

describe('listarOfertasProducto', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/catalog/productos/{id}/ofertas con el campus activo', async () => {
    const getSpy = getPorRuta({ [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [ofertaDto] });

    const resultado = await listarOfertasProducto('prod-1', 'campus-1');

    expect(getSpy).toHaveBeenCalledWith(`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`, {
      params: { campusId: 'campus-1' },
    });
    expect(resultado).toEqual([ofertaMock]);
  });

  it('devuelve lista vacía si el producto no tiene ofertas en el campus', async () => {
    getPorRuta({ [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [] });

    expect(await listarOfertasProducto('prod-1', 'campus-1')).toEqual([]);
  });
});

describe('obtenerProducto', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('arma el detalle con el producto del listado y sus ofertas del campus', async () => {
    // No hay GET /productos/{id}: el producto sale de la página del campus y
    // las ofertas de su propio endpoint, en paralelo.
    const getSpy = getPorRuta({
      [PRODUCTOS_ENDPOINT]: paginaDeProductos,
      [`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`]: [ofertaDto],
    });

    const resultado = await obtenerProducto('prod-1', 'campus-1');

    expect(getSpy).toHaveBeenCalledWith(PRODUCTOS_ENDPOINT, {
      params: { campusId: 'campus-1', size: 100 },
    });
    expect(getSpy).toHaveBeenCalledWith(`${PRODUCTOS_ENDPOINT}/prod-1/ofertas`, {
      params: { campusId: 'campus-1' },
    });
    expect(resultado).toEqual(productoMock);
  });

  it('falla con 404 si el producto no está en el catálogo del campus', async () => {
    getPorRuta({
      [PRODUCTOS_ENDPOINT]: { content: [] },
      [`${PRODUCTOS_ENDPOINT}/prod-9/ofertas`]: [],
    });

    await expect(obtenerProducto('prod-9', 'campus-1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
  });

  it('propaga el error si el gateway responde con problem+json', async () => {
    jest.spyOn(httpClient, 'get').mockRejectedValue(new Error('Producto no encontrado'));

    await expect(obtenerProducto('prod-1', 'campus-1')).rejects.toThrow('Producto no encontrado');
  });
});

describe('comparación de precios entre cafeterías (INT4-31)', () => {
  // Tres cafeterías con precios distintos y stock varied, entregadas en un orden
  // que no coincide con el alfabético ni con el de precio: si la función no
  // ordenara, estas pruebas no distinguirían nada.
  const norte = {
    ...ofertaMock,
    ofertaId: 'of-norte',
    cafeteriaNombre: 'Cafetería Norte',
    precio: 1800,
    stock: 3,
  };
  const sur = {
    ...ofertaMock,
    ofertaId: 'of-sur',
    cafeteriaNombre: 'Cafetería Sur',
    precio: 2100,
    stock: 5,
  };
  const central = {
    ...ofertaMock,
    ofertaId: 'of-central',
    cafeteriaNombre: 'Cafetería Central',
    precio: 1500,
    stock: 0,
    disponible: false,
  };

  const sinOrden = [sur, norte, central];

  describe('ordenarOfertasPorPrecio', () => {
    it('ordena de menor a mayor', () => {
      const resultado = ordenarOfertasPorPrecio(sinOrden);

      expect(resultado.map((o) => o.ofertaId)).toEqual(['of-central', 'of-norte', 'of-sur']);
    });

    it('deja las agotadas en la escalera, no al final', () => {
      // Central está agotada y es la más barata: tiene que quedar primero, en su
      // precio. Mandarla al final rompería el criterio que la lista dice aplicar.
      const resultado = ordenarOfertasPorPrecio(sinOrden);

      expect(resultado[0].ofertaId).toBe('of-central');
      expect(resultado[0].stock).toBe(0);
    });

    it('desempata a igual precio por nombre de cafetería', () => {
      const a = {
        ...ofertaMock,
        ofertaId: 'of-b',
        cafeteriaNombre: 'Cafetería Beta',
        precio: 2000,
      };
      const b = {
        ...ofertaMock,
        ofertaId: 'of-a',
        cafeteriaNombre: 'Cafetería Alfa',
        precio: 2000,
      };

      const resultado = ordenarOfertasPorPrecio([a, b]);

      expect(resultado.map((o) => o.ofertaId)).toEqual(['of-a', 'of-b']);
    });

    it('no muta el array recibido', () => {
      const original = [...sinOrden];

      ordenarOfertasPorPrecio(sinOrden);

      expect(sinOrden).toEqual(original);
    });

    it('devuelve una copia aunque la lista ya venga ordenada', () => {
      const original = [central, norte, sur];

      const resultado = ordenarOfertasPorPrecio(original);

      expect(resultado).not.toBe(original);
      expect(resultado).toEqual(original);
    });

    it('devuelve lista vacía sin Offers', () => {
      expect(ordenarOfertasPorPrecio([])).toEqual([]);
    });

    it('no revierte los precios ni el stock: solo los reordena', () => {
      const resultado = ordenarOfertasPorPrecio(sinOrden);

      expect(resultado.map((o) => o.precio)).toEqual([1500, 1800, 2100]);
      expect(resultado.map((o) => o.stock)).toEqual([0, 3, 5]);
    });
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
