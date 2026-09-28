// src/datos-locales/categorias.ts
//
// Categorías del snapshot local. Son las tres del PRODUCTOS_MOCK original.
//
// El endpoint real es GET /v1/catalog/categorias y devuelve las del catálogo
// maestro, sin filtrar por campus: las categorías no dependen de la sede. Por
// eso el snapshot no las indexa por campus tampoco.

import type { Categoria } from '../types/domain';

export const CATEGORIAS: Categoria[] = [
  { id: 'cat-bebidas', nombre: 'Bebidas' },
  { id: 'cat-pasteleria', nombre: 'Pastelería' },
  { id: 'cat-snacks', nombre: 'Snacks' },
];
