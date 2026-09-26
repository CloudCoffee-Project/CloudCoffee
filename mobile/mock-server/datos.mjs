// mock-server/datos.mjs
//
// El catálogo de ejemplo que sirve el mock mientras catalog-service no
// implemente los controllers. Son los datos del mockup (los mismos productos,
// categorías, cafeterías y campus) llevados a los nombres de campo que consume
// la app, que son los de src/types/domain.ts:
//
//   Campus    { id, nombre, direccion, cafeterias }
//   Cafeteria { id, nombre }
//   Categoria { id, nombre }
//   Producto  { id, nombre, descripcion, categoriaId, offers }
//   Oferta    { ofertaId, cafeteriaId, cafeteriaNombre, precio, stock, disponible }
//
// Por qué en un archivo aparte y no dentro del servidor: para cambiar el
// catálogo de la demo (un producto, un precio, una cafetería) se edita acá y se
// reinicia el mock. No hay lógica en este archivo: solo los datos y las dos
// funciones que los recortan por campus.
//
// CUANDO EXISTA LA BASE DE DATOS: se borra la carpeta mock-server/ completa. La
// app no sabe que este archivo existe —le habla por HTTP, igual que al gateway—
// así que no hay nada que sacar de src/.
//
// Los ids son slugs inventados ('san-francisco', 'cafe-central', 'cat-cafe'), no
// UUIDs. La app los trata como cadenas opacas: cuando el servicio real mande
// UUIDs no va a cambiar nada del lado del cliente. Los de campus coinciden con
// los que ya usa el mapeo provisional de src/services/campus.ts.

// --- Cafeterías -------------------------------------------------------------
// Un mismo producto puede tener una oferta por cafetería del campus, cada una
// con su precio y su stock: por eso un campus tiene varias cafeterías y el
// catálogo se puede comparar entre ellas (INT4-31).

const CAF_CENTRAL = 'cafe-central';
const CAF_KIOSCO_D = 'cafe-kiosco-d';
const CAF_SJPII_CENTRAL = 'cafe-sjpii-central';
const CAF_SJPII_BIBLIOTECA = 'cafe-sjpii-biblioteca';
const CAF_MENCHACA = 'cafe-menchaca';

// --- Campus -----------------------------------------------------------------
// Los tres del mockup. `cafeterias` es opcional en el tipo (ver la nota de
// Campus en src/types/domain.ts): el catálogo no lo necesita para leer precios,
// pero sin él la app no puede acotar dónde se puede retirar el pedido.

export const CAMPUS = [
  {
    id: 'san-juan-pablo-ii',
    nombre: 'Campus San Juan Pablo II',
    direccion: 'Rudecindo Ortega 02950, Temuco',
    cafeterias: [
      { id: CAF_SJPII_CENTRAL, nombre: 'Cafetería San Juan Pablo II' },
      { id: CAF_SJPII_BIBLIOTECA, nombre: 'Kiosco Biblioteca' },
    ],
  },
  {
    id: 'san-francisco',
    nombre: 'Campus San Francisco',
    direccion: 'Manuel Montt 056, Temuco',
    cafeterias: [
      { id: CAF_CENTRAL, nombre: 'Cafetería Central' },
      { id: CAF_KIOSCO_D, nombre: 'Kiosko Pabellón D' },
    ],
  },
  {
    // Sin productos en el mock: sirve para ver el estado "Sin ofertas
    // disponibles en este campus" del catálogo y del detalle.
    id: 'menchaca-lira',
    nombre: 'Campus Menchaca Lira',
    direccion: 'Av. Alemania 0211, Temuco',
    cafeterias: [{ id: CAF_MENCHACA, nombre: 'Cafetería Menchaca' }],
  },
];

// Índice id → cafetería. La app lee cafeteriaNombre de la oferta y no vuelve a
// preguntar por el id, así que el nombre tiene que viajar dentro de cada oferta
// igual que lo mandará el backend.
const CAFETERIAS_POR_ID = Object.fromEntries(
  CAMPUS.flatMap((campus) => campus.cafeterias).map((c) => [c.id, c])
);

// --- Categorías -------------------------------------------------------------
// El chip "TODOS" de la pantalla de catálogo lo arma la app, no el servicio: acá
// van solo las categorías reales.

export const CATEGORIAS = [
  { id: 'cat-cafe', nombre: 'Café' },
  { id: 'cat-pasteleria', nombre: 'Pastelería' },
  { id: 'cat-sandwiches', nombre: 'Sándwiches' },
  { id: 'cat-bebidas', nombre: 'Bebidas' },
  { id: 'cat-snacks', nombre: 'Snacks' },
];

// --- Productos --------------------------------------------------------------
// Los del mockup, con el stock necesario para poder ver los estados que la app
// sabe dibujar:
//
//   - el mismo producto en dos cafeterías con precios distintos (comparación de
//     precios y agrupado del carrito por cafetería),
//   - agotado (stock 0 con disponible false; la app muestra "Agotado" con
//     cualquiera de los dos),
//   - una cafetería sin productos (el producto llega con offers vacío).

function oferta({ cafeteriaId, ofertaId, precio, stock, disponible = true }) {
  return {
    ofertaId,
    cafeteriaId,
    cafeteriaNombre: CAFETERIAS_POR_ID[cafeteriaId]?.nombre ?? '',
    precio,
    stock,
    disponible,
  };
}

export const PRODUCTOS = [
  {
    id: 'cafe-americano-12oz',
    nombre: 'Café Americano 12oz',
    descripcion: 'Espresso doble con agua caliente, tostado medio local.',
    categoriaId: 'cat-cafe',
    offers: [
      oferta({
        ofertaId: 'of-cafe-central',
        cafeteriaId: CAF_CENTRAL,
        precio: 1800,
        stock: 12,
      }),
      oferta({
        ofertaId: 'of-cafe-kiosco-d',
        cafeteriaId: CAF_KIOSCO_D,
        precio: 1750,
        stock: 4,
      }),
    ],
  },
  {
    id: 'croissant-jamon-queso',
    nombre: 'Croissant Jamón y Queso',
    descripcion: 'Hojaldre mantequilla horneado a diario con queso gouda.',
    categoriaId: 'cat-pasteleria',
    offers: [
      oferta({
        ofertaId: 'of-croissant-central',
        cafeteriaId: CAF_CENTRAL,
        precio: 2500,
        stock: 8,
      }),
    ],
  },
  {
    id: 'sandwich-ave-palta',
    nombre: 'Sándwich Ave Palta',
    descripcion: 'Pechuga desmenuzada y palta fresca en pan ciabatta.',
    categoriaId: 'cat-sandwiches',
    offers: [
      oferta({
        ofertaId: 'of-sandwich-central',
        cafeteriaId: CAF_CENTRAL,
        precio: 3200,
        stock: 0,
        disponible: false,
      }),
    ],
  },
  {
    id: 'papas-fritas-rusticas',
    nombre: 'Papas Fritas Rústicas',
    descripcion: 'Papas fritas artesanales con sal de mar.',
    categoriaId: 'cat-snacks',
    offers: [
      oferta({
        ofertaId: 'of-papas-kiosco-d',
        cafeteriaId: CAF_KIOSCO_D,
        precio: 1500,
        stock: 15,
      }),
    ],
  },
  {
    id: 'jugo-naranja-300ml',
    nombre: 'Jugo Natural Naranja 300ml',
    descripcion: 'Recién exprimido sin azúcar añadida.',
    categoriaId: 'cat-bebidas',
    offers: [
      oferta({
        ofertaId: 'of-jugo-central',
        cafeteriaId: CAF_CENTRAL,
        precio: 2000,
        stock: 10,
      }),
    ],
  },
  {
    // Del campus San Juan Pablo II, para que el catálogo no se vea igual en
    // todas las sedes.
    id: 'te-negro-300ml',
    nombre: 'Té Negro 300ml',
    descripcion: 'Infusión de té negro sin endulzante.',
    categoriaId: 'cat-bebidas',
    offers: [
      oferta({
        ofertaId: 'of-te-sjpii-central',
        cafeteriaId: CAF_SJPII_CENTRAL,
        precio: 900,
        stock: 20,
      }),
      oferta({
        ofertaId: 'of-te-sjpii-biblioteca',
        cafeteriaId: CAF_SJPII_BIBLIOTECA,
        precio: 850,
        stock: 6,
      }),
    ],
  },
  {
    // Agotado en una cafetería y con stock en la otra: el mismo producto cambia
    // de precio y de disponibilidad según el punto de retiro.
    id: 'almuerzo-del-dia',
    nombre: 'Almuerzo del Día',
    descripcion: 'Plato del día con ensalada y jugo.',
    categoriaId: 'cat-sandwiches',
    offers: [
      oferta({
        ofertaId: 'of-almuerzo-sjpii-central',
        cafeteriaId: CAF_SJPII_CENTRAL,
        precio: 3200,
        stock: 0,
        disponible: false,
      }),
      oferta({
        ofertaId: 'of-almuerzo-sjpii-biblioteca',
        cafeteriaId: CAF_SJPII_BIBLIOTECA,
        precio: 3400,
        stock: 5,
      }),
    ],
  },
];

// --- Recortes por campus ----------------------------------------------------

/** Cafeterías de un campus, o lista vacía si el id no existe. */
export function cafeteriasDeCampus(campusId) {
  return CAMPUS.find((c) => c.id === campusId)?.cafeterias ?? [];
}

/**
 * Productos del campus, con las ofertas acotadas a sus cafeterías y filtrados por
 * categoría si viene.
 *
 * El recorte por cafetería no es un capricho del mock: es lo que dice el contrato
 * (mobile/docs/contratos-backend.md) y lo que hará el backend — lo que llega en
 * `offers` pertenece a la sede activa. Por eso un producto cuya única oferta es
 * de otra cafetería se devuelve con `offers: []`, y la app lo dibuja con su
 * estado "Sin ofertas disponibles en este campus".
 */
export function productosDelCampus(campusId, categoriaId) {
  const permitidas = new Set(cafeteriasDeCampus(campusId).map((c) => c.id));
  const productos = PRODUCTOS.map((p) => ({
    ...p,
    offers: (p.offers ?? []).filter((o) => permitidas.has(o.cafeteriaId)),
  }));

  return categoriaId ? productos.filter((p) => p.categoriaId === categoriaId) : productos;
}
