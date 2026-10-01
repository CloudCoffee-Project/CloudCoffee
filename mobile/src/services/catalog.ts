// src/services/catalog.ts
//
// Catálogo del cliente (INT4-27/28/29, INT4-30 detalle, INT4-31 comparación de
// precios): campus, categorías, productos, el detalle de un producto y el orden
// por precio de sus ofertas. Es la única fuente de datos del catálogo para la app
// móvil: las pantallas nunca pegan httpClient ni definen sus propios tipos.
//
// Contrato (doc del equipo, app móvil):
//   - GET /v1/catalog/campus                 → campus disponibles, con sus cafeterías.
//   - GET /v1/catalog/categorias             → categorías del catálogo.
//   - GET /v1/catalog/productos?campusId=    → productos del campus (paginada), con
//                                              filtro opcional de categoría.
//   - GET /v1/catalog/productos/{id}/ofertas?campusId= → las ofertas de un producto
//                                              en las cafeterías del campus.
//
// El gateway enruta /v1/catalog/** con StripPrefix=1 y declara públicas las
// consultas GET de /campus y /categorias (GatewaySecurityConfig, INT2-33). Las
// de productos y ofertas exigen sesión: el interceptor del httpClient las
// manda con el Bearer que haya, y su 401 dispara el refresh (INT4-17).
//
// Los cuatro endpoints están implementados en el catalog-service
// (PublicCatalogController + los DTO ProductResponse / ProductOfferResponse).
// El JSON no es el de las entidades: por eso el servicio traduce los DTOs del
// backend a los tipos del dominio. Ver "Shape real del catálogo" más abajo.
//
// El precio nunca sale del producto: Producto no lo tiene, y la app lee el
// precio y el stock de las Ofertas.
//
// Los tipos vienen de src/types/domain.ts (Campus, Cafeteria, Categoria,
// Oferta, Producto): no se redefinen acá ni en las pantallas, para que el
// contrato del dominio tenga un solo lugar.
//
// La búsqueda de texto NO se un parámetro del endpoint: el servicio entrega el
// catálogo del campus y la pantalla filtra sobre esos datos reales.
//
// Modelo de relación (ver backend/catalog-service): Campus 1:N Cafeteria, y
// cada Oferta pertenece a una cafeteria de un campus. Por eso un producto puede
// tener varias ofertas con precio y stock distintos, una por cafeteria del
// campus. La app las lista todas; no elige una sola.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError, httpClient } from './httpClient';
import { CAMPUS_STORAGE_KEY } from './campus';
import type { Campus, Categoria, Oferta, Producto } from '../types/domain';

// Rutas del dominio de catálogo dentro del gateway.
export const CAMPUS_ENDPOINT = '/v1/catalog/campus';
export const CATEGORIAS_ENDPOINT = '/v1/catalog/categorias';
export const PRODUCTOS_ENDPOINT = '/v1/catalog/productos';

// ---------------------------------------------------------------------------
// Shape real del catálogo (INT4-25: conexión contra el catalog-service).
//
// El backend no devuelve los tipos de src/types/domain.ts: devuelve sus DTOs, y
// hay dos diferencias que obligan a traducir en el servicio en vez de tipar la
// respuesta directo.
//
// 1. /productos es una página de Spring Data, no un array. Viene
//    `{ content: [...], totalElements, ... }`, y `content` es la parte que la app
//    usa: el resto son metadatos de paginación que el catálogo no necesita.
//
// 2. El producto NO trae sus ofertas y no existe GET /productos/{id}. Las ofertas
//    van en /productos/{id}/ofertas, con otro idioma: `price`, `stock`,
//    `cafeteriaName` y `disponible`. Como el precio vive en la oferta (RN-11/12),
//    un producto sin sus ofertas no tiene precio que mostrar, así que el servicio
//    las pide y las adjunta en `Producto.offers`: desde afuera el catálogo sigue
//    siendo la lista de productos con sus ofertas, que es lo que las pantallas
//    (INT4-28 listado, INT4-30 detalle, INT4-31 comparación) ya saben leer.
// ---------------------------------------------------------------------------

// Tamaño de página del listado. El endpoint pagina (Spring Data, 20 por
// defecto) y el catálogo de un campus cabe holgadamente en una página; se pide
// explícito para no depender de ese valor por defecto del servidor.
const TAMANO_PAGINA = 100;

// Subconjunto de la Page de Spring que la app consume.
interface PaginaSpring<T> {
  content: T[];
}

// ProductResponse del catalog-service. `imagenUrl` y `estado` los manda el
// backend pero no están en Producto del dominio: la app no muestra la foto del
// producto (usa un ícono neutro) ni cambia el estilo por su estado, así que no
// se leen. El estado lo aplica el backend en la propia consulta (solo devuelve
// productos con oferta disponible en cafetería abierta del campus).
interface ProductoResponse {
  id: string;
  categoriaId: string;
  nombre: string;
  descripcion: string;
}

// ProductOfferResponse del catalog-service.
interface OfertaResponse {
  id: string;
  cafeteriaId: string;
  cafeteriaName: string;
  price: number;
  stock: number;
  disponible: boolean;
}

/** Ruta de las ofertas de un producto en el campus indicado. */
export function ofertasEndpoint(productoId: string): string {
  return `${PRODUCTOS_ENDPOINT}/${productoId}/ofertas`;
}

// El precio y el stock llegan como number de un BigDecimal del backend; se
// convierten acá para que el resto de la app los trate como números sin castear
// en cada pantalla.
function mapearOferta(dto: OfertaResponse): Oferta {
  return {
    ofertaId: dto.id,
    cafeteriaId: dto.cafeteriaId,
    cafeteriaNombre: dto.cafeteriaName,
    precio: Number(dto.price),
    stock: Number(dto.stock),
    disponible: dto.disponible,
  };
}

function mapearProducto(dto: ProductoResponse): Producto {
  return {
    id: dto.id,
    nombre: dto.nombre,
    descripcion: dto.descripcion,
    categoriaId: dto.categoriaId,
  };
}

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
 * Llama a GET /v1/catalog/productos/{id}/ofertas y devuelve las ofertas de ese
 * producto en las cafeterías del campus. Es el precio y el stock de la sede
 * activa, no los de otra (RN-11/12).
 */
export async function listarOfertasProducto(
  productoId: string,
  campusId: string
): Promise<Oferta[]> {
  const response = await httpClient.get<OfertaResponse[]>(ofertasEndpoint(productoId), {
    params: { campusId },
  });

  return response.data.map(mapearOferta);
}

// Trae los productos del campus SIN ofertas. El listado y el detalle los usan
// para conseguir nombre, descripción y categoría; las ofertas llegan aparte.
async function pedirProductos(campusId: string, categoriaId?: string): Promise<Producto[]> {
  const response = await httpClient.get<PaginaSpring<ProductoResponse>>(PRODUCTOS_ENDPOINT, {
    params: categoriaId
      ? { campusId, categoriaId, size: TAMANO_PAGINA }
      : { campusId, size: TAMANO_PAGINA },
  });

  return response.data.content.map(mapearProducto);
}

/**
 * Llama a GET /v1/catalog/productos para un campus y, opcionalmente, para una
 * categoría, y devuelve los productos con sus ofertas del campus ya adjuntas.
 *
 * El campus es obligatorio porque el catálogo es relativo a la sede elegida
 * (RN-11/12): los precios y el stock difieren por cafetería.
 *
 * El backend no manda las ofertas con el producto, así que se piden una por
 * producto y se adjuntan. Van en paralelo (Promise.all) para que la pantalla
 * espere una sola vez y no una por tarjeta: con el catálogo de un campus son
 * unas pocas decenas de peticiones. Si alguna falla, la promesa rechaza y la
 * pantalla muestra el error normalizado con botón de reintento, en vez de
 * mostrar el producto sin precio (que se vería como "Sin ofertas", que es un
 * dato falso).
 */
export async function listarProductos(campusId: string, categoriaId?: string): Promise<Producto[]> {
  const productos = await pedirProductos(campusId, categoriaId);
  const conOfertas = await Promise.all(
    productos.map(async (producto) => ({
      ...producto,
      offers: await listarOfertasProducto(producto.id, campusId),
    }))
  );

  return conOfertas;
}

/**
 * Devuelve el detalle de un producto (INT4-30) con las ofertas del campus.
 *
 * Se arma con los dos endpoints que existen: el producto sale del listado del
 * campus (no hay GET /productos/{id}) y las ofertas de
 * GET /productos/{id}/ofertas. Si el producto no está en el catálogo del campus
 * —porque no existe, o porque el backend no lo devuelve al no tener oferta
 * disponible en esa sede— se devuelve un ApiError 404 en vez de un Producto a
 * medias, para que la pantalla muestre su aviso de error con reintento.
 */
export async function obtenerProducto(productoId: string, campusId: string): Promise<Producto> {
  const [productos, ofertas] = await Promise.all([
    pedirProductos(campusId),
    listarOfertasProducto(productoId, campusId),
  ]);

  const producto = productos.find((item) => item.id === productoId);
  if (!producto) {
    throw new ApiError('El producto no existe en este campus.', 404);
  }

  return { ...producto, offers: ofertas };
}

// ---------------------------------------------------------------------------
// Comparación de precios entre cafeterías (INT4-31).
//
// Un producto puede tener una oferta por cafetería del campus, cada una con su
// precio. Para comparar hay que ordenarlas, y ese orden NO viene del endpoint:
// el backend devuelve las ofertas en el orden que le sale de la consulta, que
// no es un contrato. Ordenar acá sobre los datos ya traídos deja el resultado
// igual en el detalle y en el catálogo, y no depende de que el backend devuelva
// casualmente un orden útil.
//
// El criterio es fijo: de menor a mayor precio. Es el que hace comparable la
// lista sin que la persona tenga que tocar nada, y el mismo en el detalle y en
// el catálogo. No hay control de orden en pantalla.
//
// Las ofertas agotadas se ordenan con las disponibles y no se van al final: la
// lista es la escalera de precios del campus, y la tarjeta agotada ya se dibuja
// deshabilitada y con su "Agotado". Sacarlas al final haría que la más barata
// dejara de estar arriba, que es justo lo que se viene a ver.
// ---------------------------------------------------------------------------

/**
 * Ordena las ofertas de un producto de menor a mayor precio.
 *
 * No muta el array recibido: devuelve una copia, porque `ofertas` viene de la
 * respuesta del servicio y las pantallas la reutilizan para el total, el stock y
 * la selección. A igual precio desempata por nombre de cafetería para que el
 * orden sea estable y no cambie entre renders cuando dos puntos de retiro
 * cobran lo mismo.
 */
export function ordenarOfertasPorPrecio(ofertas: Oferta[]): Oferta[] {
  return [...ofertas].sort((a, b) => {
    if (a.precio !== b.precio) {
      return a.precio - b.precio;
    }
    return a.cafeteriaNombre.localeCompare(b.cafeteriaNombre, 'es');
  });
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
