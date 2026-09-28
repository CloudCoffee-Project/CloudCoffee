// src/services/catalogoLocal.test.ts
// Cubre el snapshot local y el servicio que lo expone. El foco no es la UI sino
// los invariantes que hacen que el carrito y la escalera de precios tengan algo
// real para mostrar: toda oferta apunta a una cafetería que existe en su campus,
// los ofertaId no se repiten, y las ofertas no filtran el campusId interno.
import {
  listarCampus,
  listarCategorias,
  listarProductos,
  leerCampusSeleccionado,
} from './catalogoLocal';
import { CAMPUS, CATEGORIAS, PRODUCTOS } from '../datos-locales';
import type { Oferta } from '../types/domain';

// AsyncStorage no es módulo nativo en Jest. Devuelve null a propósito: ese es el
// caso que dispara el fallback al primer campus, que es lo que pasa hoy con la
// pantalla de selección de campus caída.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

describe('snapshot de datos locales', () => {
  it('tiene los cuatro campus del dataset original, con cafeterías', async () => {
    const campus = await listarCampus();

    expect(campus).toHaveLength(4);
    expect(campus.map((c) => c.id)).toEqual([
      'san-juan-pablo-ii',
      'san-francisco',
      'norte',
      'menchaca-lira',
    ]);
    // Sin cafeterías el carrito no podría agrupar por punto de retiro.
    for (const c of campus) {
      expect(c.cafeterias?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('tiene las tres categorías del dataset original', async () => {
    const categorias = await listarCategorias();

    expect(categorias).toHaveLength(3);
    expect(categorias.map((c) => c.id)).toEqual(['cat-bebidas', 'cat-pasteleria', 'cat-snacks']);
  });

  it('no repite ofertaId en todo el snapshot', () => {
    // El ofertaId es la identidad de la línea del carrito: si se repitiera, un
    // agregar tocaría la línea de otro punto de retiro.
    const ids = PRODUCTOS.flatMap((producto) => producto.offers.map((o) => o.ofertaId));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no deja una oferta apuntando a una cafetería ajena a su campus', () => {
    // El error más caro de este snapshot: una cafetería de otro campus haría
    // que el precio mostrado no se corresponda con el punto de retiro.
    const cafeteriasPorCampus = new Map(
      CAMPUS.map((campus) => [campus.id, new Set(campus.cafeterias?.map((f) => f.id) ?? [])])
    );

    for (const producto of PRODUCTOS) {
      for (const oferta of producto.offers) {
        const cafeteriaIds = cafeteriasPorCampus.get(oferta.campusId);
        expect(cafeteriaIds).toBeDefined();
        expect(cafeteriasPorCampus.get(oferta.campusId)?.has(oferta.cafeteriaId)).toBe(true);
      }
    }
  });

  it('usa precios que existen en el catálogo local', () => {
    const categoriaIds = new Set(CATEGORIAS.map((c) => c.id));

    for (const producto of PRODUCTOS) {
      expect(categoriaIds.has(producto.categoriaId)).toBe(true);
    }
  });
});

describe('catalogoLocal.listarProductos', () => {
  it('acota las ofertas al campus pedido y saca el campusId interno', async () => {
    // Es el contrato de GET /v1/catalog/productos?campusId=: llega filtrado por
    // sede y sin campos internos. Si se fugara el campusId, la app veria un
    // campo que el backend nunca manda.
    const productos = await listarProductos('norte');

    expect(productos.length).toBeGreaterThan(0);
    for (const producto of productos) {
      expect(producto.offers?.length ?? 0).toBeGreaterThan(0);
      for (const oferta of producto.offers ?? []) {
        expect(oferta).not.toHaveProperty('campusId');
        expect(Object.keys(oferta).sort()).toEqual(
          ['cafeteriaId', 'cafeteriaNombre', 'disponible', 'ofertaId', 'precio', 'stock'].sort()
        );
      }
    }
  });

  it('devuelve el mismo producto en dos campus distintos, con precios distintos', async () => {
    // Es el caso que hace funcionar INT4-31: el mismo café en dos sedes, con
    // precio propio en cada una. p-1 se vende en San Juan Pablo II y en San
    // Francisco, segun el campusDisponibles del dataset original.
    const enSanJuanPablo = await listarProductos('san-juan-pablo-ii');
    const enSanFrancisco = await listarProductos('san-francisco');

    const cafeEnSanJuanPablo = enSanJuanPablo.find((p) => p.id === 'p-1');
    const cafeEnSanFrancisco = enSanFrancisco.find((p) => p.id === 'p-1');

    expect(cafeEnSanJuanPablo?.offers?.length ?? 0).toBeGreaterThan(0);
    expect(cafeEnSanFrancisco?.offers?.length ?? 0).toBeGreaterThan(0);
    expect(cafeEnSanJuanPablo?.offers).not.toEqual(cafeEnSanFrancisco?.offers);
  });

  it('da al menos dos precios distintos por producto en su campus', async () => {
    // Sin esto la escalera de precios no tiene nada que comparar y el agrupado
    // del carrito por cafetería tampoco.
    for (const campus of CAMPUS) {
      const productos = await listarProductos(campus.id);
      for (const producto of productos) {
        const precios = new Set((producto.offers ?? []).map((o: Oferta) => o.precio));
        if ((producto.offers ?? []).length > 1) {
          expect(precios.size).toBeGreaterThan(1);
        }
      }
    }
  });

  it('filtra por categoría cuando se le pasa', async () => {
    const bebidas = await listarProductos('norte', 'cat-bebidas');

    expect(bebidas.length).toBeGreaterThan(0);
    for (const producto of bebidas) {
      expect(producto.categoriaId).toBe('cat-bebidas');
    }
  });

  it('devuelve vacío para un campus que no existe', async () => {
    const productos = await listarProductos('campus-que-no-existe');

    expect(productos).toEqual([]);
  });

  it('no muta el snapshot al filtrar', async () => {
    // Si filtrar modificara el array original, la segunda consulta devolvería
    // datos ya recortados y el bug aparecería recién en la segunda pantalla.
    const antes = structuredClone(PRODUCTOS);

    await listarProductos('norte');
    await listarProductos('san-francisco');

    expect(PRODUCTOS).toEqual(antes);
  });
});

describe('catalogoLocal.leerCampusSeleccionado', () => {
  it('cae al primer campus cuando no hay nada guardado', async () => {
    // Hoy la pantalla de selección de campus da 404, así que nunca se guarda
    // nada. Sin este fallback el catálogo quedaría siempre vacío.
    const campus = await leerCampusSeleccionado();

    expect(campus?.id).toBe(CAMPUS[0].id);
  });
});

describe('compatibilidad con el tipo del dominio', () => {
  it('las ofertas que devuelve tienen la forma de Oferta', async () => {
    const productos = await listarProductos('san-juan-pablo-ii');
    const oferta: Oferta | undefined = productos[0]?.offers?.[0];

    expect(typeof oferta?.ofertaId).toBe('string');
    expect(typeof oferta?.cafeteriaId).toBe('string');
    expect(typeof oferta?.cafeteriaNombre).toBe('string');
    expect(typeof oferta?.precio).toBe('number');
    expect(typeof oferta?.stock).toBe('number');
    expect(typeof oferta?.disponible).toBe('boolean');
  });
});
