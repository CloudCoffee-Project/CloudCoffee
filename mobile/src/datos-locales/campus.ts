// src/datos-locales/campus.ts
//
// Campus y cafeterías del snapshot local. Ver README.md de esta carpeta para
// saber por qué existe y cuándo se borra.
//
// Las cafeterías van por campus y no son un catálogo plano porque el modelo es
// Campus 1:N Cafeteria: cada sede tiene sus propios puntos de retiro, con
// precio y stock propios para un mismo producto. Por eso dos campus pueden
// tener ambos una "Cafetería Central" y son dos cafeterías distintas, con ids
// distintos: se retiran en lugares distintos y el carrito las agrupa separado.
//
// Los ids de campus son los del PRODUCTOS_MOCK original (san-juan-pablo-ii,
// san-francisco, norte, menchaca-lira) para que el snapshot se pueda comparar
// contra el dataset viejo sin traducción de ids. Los ids de cafetería son
// nuevos, con el prefijo del campus, porque el modelo los hace únicos por sede.

import type { Campus } from '../types/domain';

export const CAMPUS: Campus[] = [
  {
    id: 'san-juan-pablo-ii',
    nombre: 'San Juan Pablo II',
    direccion: 'Av. Universidad 1200, Campus Norte',
    cafeterias: [
      { id: 'sjp-ii-central', nombre: 'Cafetería Central' },
      { id: 'sjp-ii-kiosko', nombre: 'Kiosko Central' },
      { id: 'sjp-ii-casino', nombre: 'Casino Principal' },
    ],
  },
  {
    id: 'san-francisco',
    nombre: 'San Francisco',
    direccion: 'Calle San Francisco 455, Campus Sur',
    cafeterias: [
      { id: 'sf-central', nombre: 'Cafetería Central' },
      { id: 'sf-kiosko', nombre: 'Kiosko Central' },
    ],
  },
  {
    id: 'norte',
    nombre: 'Norte',
    direccion: 'Pabellón Norte, Acceso 3',
    cafeterias: [
      { id: 'norte-casino', nombre: 'Casino Principal' },
      { id: 'norte-central', nombre: 'Cafetería Central' },
      { id: 'norte-kiosko', nombre: 'Kiosko Central' },
    ],
  },
  {
    id: 'menchaca-lira',
    nombre: 'Menchaca Lira',
    direccion: 'Camino Menchaca Lira km 2, Campus Oriente',
    cafeterias: [
      { id: 'ml-kiosko', nombre: 'Kiosco Central' },
      { id: 'ml-central', nombre: 'Cafetería Central' },
    ],
  },
];
