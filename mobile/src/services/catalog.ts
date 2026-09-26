// src/services/catalog.ts
//
// Catálogo del cliente (INT4-27/28/29): campus, categorías y productos. Es la
// única fuente de datos del catálogo para la app móvil: las pantallas nunca
// pegan httpClient ni definen sus propios tipos.
//
// Contrato (doc del equipo, app móvil):
//   - GET /v1/catalog/campus             → campus disponibles.
//   - GET /v1/catalog/categorias         → categorías del catálogo.
//   - GET /v1/catalog/productos          → productos del campus, con filtro
//                                          opcional de categoría.
//
// El gateway ya enruta /v1/catalog/** y declara públicas las consultas GET de
// /campus y /categorias (GatewaySecurityConfig, INT2-33). La ruta de productos
// sigue el mismo prefijo, que es la canónica del dominio.
//
// TODO: el catalog-service todavía NO implementa los controllers (solo tiene
// entidades, enums y repositorios). Consumimos el contrato real y, si el
// gateway responde con problem+json, la pantalla muestra el error normalizado
// vía toApiError con botón de reintento — nunca una lista hardcodeada. Mismo
// contrato provisional que ordenes.ts y seguimientos.ts.
//
// Los tipos vienen de src/types/domain.ts (Campus, Categoria, Producto,
// Oferta): no se redefinen acá ni en las pantallas, para que el contrato del
// dominio tenga un solo lugar.
//
// La búsqueda de texto NO es un parámetro del endpoint: el servicio entrega el
// catálogo del campus y la pantalla filtra sobre esos datos reales.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { httpClient } from './httpClient';
import { CAMPUS_STORAGE_KEY, cafeteriaIdDeCampus } from './campus';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

// Rutas del dominio de catálogo dentro del gateway.
export const CAMPUS_ENDPOINT = '/v1/catalog/campus';
export const CATEGORIAS_ENDPOINT = '/v1/catalog/categorias';
export const PRODUCTOS_ENDPOINT = '/v1/catalog/productos';

/** Llama a GET /v1/catalog/campus y devuelve los campus del catálogo. */
export async function listarCampus(): Promise<Campus[]> {
  const response = await httpClient.get<Campus[]>(CAMPUS_ENDPOINT);

  return response.data;
}

/** Llama a GET /v1/catalog/categorias y devuelve las categorías del catálogo. */
export async function listarCategorias(): Promise<Categoria[]> {
  const response = await httpClient.get<Categoria[]>(CATEGORIAS_ENDPOINT);

  return response.data;
}

/**
 * Llama a GET /v1/catalog/productos para un campus y, opcionalmente, para una
 * categoría. El campus es obligatorio porque el catálogo es relativo a la sede
 * elegida (RN-11/12): los precios y el stock difieren por cafetería.
 */
export async function listarProductos(campusId: string, categoriaId?: string): Promise<Producto[]> {
  const response = await httpClient.get<Producto[]>(PRODUCTOS_ENDPOINT, {
    params: categoriaId ? { campusId, categoriaId } : { campusId },
  });

  return response.data;
}

/**
 * Devuelve la oferta del producto en una cafetería concreta, o null si el
 * producto no tiene oferta ahí. El precio y el stock que muestra la tarjeta
 * salen siempre de esta oferta: nunca del producto, que no los tiene.
 */
export function ofertaDeCafeteria(producto: Producto, cafeteriaId: string | null): Oferta | null {
  if (!cafeteriaId || !producto.offers) {
    return null;
  }

  return producto.offers.find((oferta) => oferta.cafeteriaId === cafeteriaId) ?? null;
}

// ---------------------------------------------------------------------------
// Persistencia del campus seleccionado.
//
// La clave vive en services/campus.ts (CAMPUS_STORAGE_KEY) porque ese módulo
// es el que también resuelve la cafetería del campus y lo importan los hooks
// de notificaciones. Acá queda el acceso al almacén: las pantallas guardan y
// leen la selección desde acá en vez de tocar AsyncStorage directamente.
// ---------------------------------------------------------------------------

/**
 * Lee el campus seleccionado. Tolera datos ausentes o corruptos: devuelve null
 * en vez de propagar el error, porque un campus no legible solo significa
 * "aún no eligió", no una falla de la app.
 */
export async function leerCampusSeleccionado(): Promise<Campus | null> {
  try {
    const crudo = await AsyncStorage.getItem(CAMPUS_STORAGE_KEY);
    if (!crudo) {
      return null;
    }

    const campus = JSON.parse(crudo) as Partial<Campus> | null;
    if (campus && typeof campus.id === 'string' && typeof campus.nombre === 'string') {
      // Se reconstruye el campus en vez de devolver el objeto crudo para
      // descartar campos sueltos, conservando la cafeteria que trae el
      // catálogo: es la que permite leer precios y stock después.
      return {
        id: campus.id,
        nombre: campus.nombre,
        direccion: campus.direccion ?? '',
        cafeteriaId: campus.cafeteriaId,
        cafeteriaNombre: campus.cafeteriaNombre,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resuelve la cafetería cuyo catálogo se está mostrando.
 *
 * Fuente principal: el propio DTO del campus, que ya trae cafeteriaId. Es la
 * forma definitiva y no depende de nada local.
 *
 * TODO: el gateway sirve GET /v1/catalog/campus desde INT2-33, pero el
 * catalog-service todavía no implementa el controller y su entidad Campus
 * solo tiene name/location. Para cerrar el contrato el DTO de campus debe
 * exponer cafeteriaId (y cafeteriaNombre) con los nombres de domain.ts.
 *
 * Mientras tanto se cae al mapeo provisional de services/campus.ts, que
 * cubre los cuatro campus con ids slug del mockup. Ese mapeo devuelve null
 * para los UUID reales: si pasa eso, el catálogo se muestra sin precios ni
 * stock hasta que el backend entregue la cafetería. No se inventan datos.
 */
export function cafeteriaIdDeCampusSeleccionado(campus: Campus | null | undefined): string | null {
  if (!campus) {
    return null;
  }

  return campus.cafeteriaId ?? cafeteriaIdDeCampus(campus.id);
}

/** Guarda el campus elegido por el cliente como sede activa. */
export async function guardarCampusSeleccionado(campus: Campus): Promise<void> {
  await AsyncStorage.setItem(CAMPUS_STORAGE_KEY, JSON.stringify(campus));
}

/** Borra la selección guardada (volver a elegir sede al entrar). */
export async function limpiarCampusSeleccionado(): Promise<void> {
  await AsyncStorage.removeItem(CAMPUS_STORAGE_KEY);
}
