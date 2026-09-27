// src/datos-locales/productos.ts
//
// Los cuatro productos del PRODUCTOS_MOCK original, con sus ofertas por
// cafetería. Ver README.md de esta carpeta para el porqué.
//
// Ojo con la forma: acá cada Oferta lleva además un campusId que NO es parte del
// tipo Oferta de types/domain.ts. Es interno del snapshot y existe solo para
// poder filtrar por sede, que es lo que hace el endpoint real con su parámetro
// ?campusId=. services/catalogoLocal.ts lo saca antes de devolver, así que la
// app nunca ve este campo: recibe exactamente lo que devolvería el backend.
//
// Ojo también con la identidad de una Oferta: es ofertaId, y es lo que usa el
// carrito para agregar, cambiar cantidad y quitar. Por eso el id compone
// producto + campus + cafetería y no se repite en ningun par del snapshot.
//
// Los precios no son todos iguales a propósito. El original tenía un solo precio
// por producto, y con un solo precio la escalera de precios de INT4-31 no
// tenía nada que comparar. Ahora el mismo producto aparece en dos o tres
// cafeterías con precios distintos, que es el caso que la pantalla muestra.

import type { Oferta, Producto } from '../types/domain';

export interface OfertaLocal extends Oferta {
  // Interno del snapshot, se elimina al filtrar por campus. Ver nota arriba.
  campusId: string;
}

export interface ProductoLocal extends Omit<Producto, 'offers'> {
  offers: OfertaLocal[];
}

export const PRODUCTOS: ProductoLocal[] = [
  {
    id: 'p-1',
    nombre: 'Café Americano 12oz',
    descripcion: 'Espresso doble con agua caliente, tostado medio local.',
    categoriaId: 'cat-bebidas',
    offers: [
      {
        ofertaId: 'of-p-1-sjp-ii-central',
        campusId: 'san-juan-pablo-ii',
        cafeteriaId: 'sjp-ii-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 1800,
        stock: 40,
        disponible: true,
      },
      {
        // Mas barato que la Central: es lo que hace visible la escalera.
        ofertaId: 'of-p-1-sjp-ii-kiosko',
        campusId: 'san-juan-pablo-ii',
        cafeteriaId: 'sjp-ii-kiosko',
        cafeteriaNombre: 'Kiosko Central',
        precio: 1650,
        stock: 12,
        disponible: true,
      },
      {
        ofertaId: 'of-p-1-sf-central',
        campusId: 'san-francisco',
        cafeteriaId: 'sf-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 1800,
        stock: 25,
        disponible: true,
      },
      {
        ofertaId: 'of-p-1-sf-kiosko',
        campusId: 'san-francisco',
        cafeteriaId: 'sf-kiosko',
        cafeteriaNombre: 'Kiosko Central',
        precio: 1900,
        stock: 8,
        disponible: true,
      },
    ],
  },
  {
    id: 'p-2',
    nombre: 'Croissant Jamón y Queso',
    descripcion: 'Hojaldre mantequilla horneado a diario con queso gouda.',
    categoriaId: 'cat-pasteleria',
    offers: [
      {
        ofertaId: 'of-p-2-sf-kiosko',
        campusId: 'san-francisco',
        cafeteriaId: 'sf-kiosko',
        cafeteriaNombre: 'Kiosko Central',
        precio: 2400,
        stock: 18,
        disponible: true,
      },
      {
        ofertaId: 'of-p-2-sf-central',
        campusId: 'san-francisco',
        cafeteriaId: 'sf-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 2500,
        stock: 30,
        disponible: true,
      },
      {
        ofertaId: 'of-p-2-norte-casino',
        campusId: 'norte',
        cafeteriaId: 'norte-casino',
        cafeteriaNombre: 'Casino Principal',
        precio: 2500,
        stock: 15,
        disponible: true,
      },
      {
        ofertaId: 'of-p-2-norte-central',
        campusId: 'norte',
        cafeteriaId: 'norte-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 2650,
        stock: 6,
        disponible: true,
      },
    ],
  },
  {
    id: 'p-3',
    nombre: 'Jugo Natural de Naranja',
    descripcion: 'Jugo 100% natural recién exprimido 300ml.',
    categoriaId: 'cat-bebidas',
    offers: [
      {
        ofertaId: 'of-p-3-norte-central',
        campusId: 'norte',
        cafeteriaId: 'norte-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 1950,
        stock: 22,
        disponible: true,
      },
      {
        ofertaId: 'of-p-3-norte-casino',
        campusId: 'norte',
        cafeteriaId: 'norte-casino',
        cafeteriaNombre: 'Casino Principal',
        precio: 2000,
        stock: 35,
        disponible: true,
      },
      {
        ofertaId: 'of-p-3-ml-kiosko',
        campusId: 'menchaca-lira',
        cafeteriaId: 'ml-kiosko',
        cafeteriaNombre: 'Kiosco Central',
        precio: 2000,
        stock: 14,
        disponible: true,
      },
      {
        ofertaId: 'of-p-3-ml-central',
        campusId: 'menchaca-lira',
        cafeteriaId: 'ml-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 2100,
        stock: 9,
        disponible: true,
      },
    ],
  },
  {
    id: 'p-4',
    nombre: 'Mix de Frutos Secos',
    descripcion: 'Almendras, nueces, maní sin sal y pasas 100g.',
    categoriaId: 'cat-snacks',
    offers: [
      {
        // El mas barato de todo el snapshot, en el unico kiosko de Norte.
        ofertaId: 'of-p-4-norte-kiosko',
        campusId: 'norte',
        cafeteriaId: 'norte-kiosko',
        cafeteriaNombre: 'Kiosko Central',
        precio: 1450,
        stock: 50,
        disponible: true,
      },
      {
        ofertaId: 'of-p-4-sjp-ii-kiosko',
        campusId: 'san-juan-pablo-ii',
        cafeteriaId: 'sjp-ii-kiosko',
        cafeteriaNombre: 'Kiosko Central',
        precio: 1500,
        stock: 45,
        disponible: true,
      },
      {
        ofertaId: 'of-p-4-sf-kiosko',
        campusId: 'san-francisco',
        cafeteriaId: 'sf-kiosko',
        cafeteriaNombre: 'Kiosko Central',
        precio: 1500,
        stock: 28,
        disponible: true,
      },
      {
        ofertaId: 'of-p-4-ml-kiosko',
        campusId: 'menchaca-lira',
        cafeteriaId: 'ml-kiosko',
        cafeteriaNombre: 'Kiosco Central',
        precio: 1500,
        stock: 20,
        disponible: true,
      },
      {
        ofertaId: 'of-p-4-sjp-ii-central',
        campusId: 'san-juan-pablo-ii',
        cafeteriaId: 'sjp-ii-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 1600,
        stock: 16,
        disponible: true,
      },
      {
        ofertaId: 'of-p-4-ml-central',
        campusId: 'menchaca-lira',
        cafeteriaId: 'ml-central',
        cafeteriaNombre: 'Cafetería Central',
        precio: 1550,
        stock: 11,
        disponible: true,
      },
    ],
  },
];
