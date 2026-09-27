// src/datos-locales/index.ts
//
// Reexporta el snapshot para que services/catalogoLocal.ts tenga un solo import.
// La app nunca importa de acá directo: pasa siempre por el servicio, que es el
// punto de swap hacia el backend.

export { CAMPUS } from './campus';
export { CATEGORIAS } from './categorias';
export { PRODUCTOS } from './productos';
export type { OfertaLocal, ProductoLocal } from './productos';
