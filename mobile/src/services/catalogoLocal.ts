// src/services/catalogoLocal.ts
//
// Misma interfaz que services/catalog.ts, pero leyendo del snapshot de
// src/datos-locales en vez de pegarle al gateway. Mismas firmas a proposito: la
// idea es que app/(cliente)/index.tsx no sepa de donde vienen los datos y en el
// sprint de la conexion directa a la base se cambie solo el import.
//
// Que sea "local" no significa "sincrono". Las funciones son async y devuelven
// promesas como las del servicio real, porque el codigo que las consume no
// deberia tener que distinguir el origen: si alguna vez se pasa a leer de disco
// o de una base local, las firmas no cambian.
//
// NO reexporta ordenarOfertasPorPrecio a proposito: esa funcion es pura, no
// depende de donde vengan los datos, y sigue vivendo en services/catalog.ts
// para que las dos rutas ordenen exactamente igual.
//
// Cuando el backend exponga GET /v1/catalog/*, este archivo se borra junto con
// src/datos-locales/ y el import de index.tsx vuelve a services/catalog.

import { CAMPUS, CATEGORIAS, PRODUCTOS } from '../datos-locales';
import type { ProductoLocal } from '../datos-locales';
import { leerCampusSeleccionado as leerCampusGuardado } from './catalog';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

// Saca el campusId interno del snapshot y devuelve Oferta[], que es lo que la
// app conoce. El endpoint real no manda ese campo porque ya viene filtrado por
// sede; el snapshot guarda todas las sedes en un solo lugar y filtra aca, asi
// que hay que imitar la forma de la respuesta.
function ofertasDeProducto(producto: ProductoLocal, campusId: string): Oferta[] {
  return producto.offers
    .filter((oferta) => oferta.campusId === campusId)
    .map(({ campusId: _campusId, ...oferta }) => oferta);
}

export async function listarCampus(): Promise<Campus[]> {
  return CAMPUS;
}

export async function listarCategorias(): Promise<Categoria[]> {
  return CATEGORIAS;
}

// Acota el resultado al campus y, si viene categoriaId, a esa categoria. Es el
// mismo contrato que GET /v1/catalog/productos?campusId=&categoriaId=.
export async function listarProductos(campusId: string, categoriaId?: string): Promise<Producto[]> {
  return PRODUCTOS.filter(
    (producto) =>
      producto.offers.some((oferta) => oferta.campusId === campusId) &&
      (categoriaId === undefined || producto.categoriaId === categoriaId)
  ).map((producto) => ({
    id: producto.id,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    categoriaId: producto.categoriaId,
    offers: ofertasDeProducto(producto, campusId),
  }));
}

// Si no hay campus guardado devuelve el primero del snapshot en vez de null.
//
// Esto es una diferencia real contra el servicio de HTTP, y es a proposito: la
// pantalla de seleccion de campus llama a GET /v1/catalog/campus, que hoy da
// 404, asi que nunca se llega a guardar nada. Sin este fallback el catalogo
// quedaria vacio siempre y no habria forma de ver el snapshot. El día que el
// backend exista, index.tsx vuelve a services/catalog y este fallback desaparece
// con el archivo.
export async function leerCampusSeleccionado(): Promise<Campus | null> {
  const guardado = await leerCampusGuardado();
  return guardado ?? CAMPUS[0] ?? null;
}
