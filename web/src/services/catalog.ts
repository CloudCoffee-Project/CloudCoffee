import { request } from './httpClient';

export interface Campus {
  id: string;
  nombre: string;
}

export interface Category {
  id: string;
  nombre: string;
}

export interface Product {
  id: string;
  categoriaId: string;
  nombre: string;
  descripcion: string | null;
  imagenUrl: string | null;
  estado: string;
}

export interface ProductPage {
  content: Product[];
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

export interface ProductFilters {
  campusId: string;
  categoriaId: string;
  q: string;
  page: number;
}

export function getCampus(signal: AbortSignal) {
  return request<Campus[]>('/v1/catalog/campus', { signal });
}

export function getCategories(signal: AbortSignal) {
  return request<Category[]>('/v1/catalog/categorias', { signal });
}

export function getProducts(filters: ProductFilters, signal: AbortSignal) {
  const params = new URLSearchParams({
    campusId: filters.campusId,
    page: String(filters.page),
    size: '12',
  });
  if (filters.categoriaId) params.set('categoriaId', filters.categoriaId);
  if (filters.q.trim()) params.set('q', filters.q.trim());
  // Un desempate por ID mantiene el orden al recorrer las páginas.
  params.append('sort', 'name,asc');
  params.append('sort', 'id,asc');
  return request<ProductPage>(`/v1/catalog/productos?${params}`, { signal });
}
