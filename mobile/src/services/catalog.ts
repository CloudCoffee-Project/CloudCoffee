// src/services/catalog.ts
//
// Catálogo del cliente (INT4-27/28/29, INT4-30 detalle): campus, categorías,
// productos y el detalle de un producto. Es la única fuente de datos del
// catálogo para la app móvil: las pantallas nunca pegan httpClient ni definen
// sus propios tipos.
//
// Contrato (doc del equipo, app móvil):
//   - GET /v1/catalog/campus             → campus disponibles.
//   - GET /v1/catalog/categorias         → categorías del catálogo.
//   - GET /v1/catalog/productos          → productos del campus, con filtro
//                                          opcional de categoría.
//   - GET /v1/catalog/productos/{id}     → detalle de un producto (INT4-30),
//                                          con sus ofertas en el campus.
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
// Los tipos vienen de src/types/domain.ts (Campus, Cafeteria, Categoria,
// Oferta, Producto): no se redefinen acá ni en las pantallas, para que el
// contrato del dominio tenga un solo lugar.
//
// La búsqueda de texto NO es un parámetro del endpoint: el servicio entrega el
// catálogo del campus y la pantalla filtra sobre esos datos reales.
//
// Modelo de relación (ver backend/catalog-service): Campus 1:N Cafeteria, y
// cada Oferta pertenece a una cafeteria de un campus. Por eso un producto puede
// tener varias ofertas con precio y stock distintos, una por cafeteria del
// campus. La app las lista todas; no elige una sola.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { httpClient } from './httpClient';
import { CAMPUS_STORAGE_KEY } from './campus';
import type { Campus, Categoria, Producto } from '../types/domain';

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
 * Llama a GET /v1/catalog/productos/{id} para el detalle de un producto (INT4-30).
 * El campus se manda siempre: el precio y el stock del detalle son los de esa
 * sede, no los de otra.
 */
export async function obtenerProducto(productoId: string, campusId: string): Promise<Producto> {
  const response = await httpClient.get<Producto>(`${PRODUCTOS_ENDPOINT}/${productoId}`, {
    params: { campusId },
  });

  return response.data;
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
      // descartar campos sueltos, conservando las cafeterías que trae el
      // catálogo: son las que acotan dónde se puede retirar el pedido.
      return {
        id: campus.id,
        nombre: campus.nombre,
        direccion: campus.direccion ?? '',
        cafeterias: Array.isArray(campus.cafeterias) ? campus.cafeterias : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Guarda el campus elegido por el cliente como sede activa. */
export async function guardarCampusSeleccionado(campus: Campus): Promise<void> {
  await AsyncStorage.setItem(CAMPUS_STORAGE_KEY, JSON.stringify(campus));
}

/** Borra la selección guardada (volver a elegir sede al entrar). */
export async function limpiarCampusSeleccionado(): Promise<void> {
  await AsyncStorage.removeItem(CAMPUS_STORAGE_KEY);
}
