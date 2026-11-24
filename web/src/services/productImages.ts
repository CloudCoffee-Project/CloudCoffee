import { env } from '../config/env';
import { request } from './httpClient';
export interface ImageProduct { id: string; nombre: string; imagenUrl: string | null; estado: string }
export interface ImagePage { content: ImageProduct[]; number: number; totalPages: number }
export function productImageUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  return value.startsWith('/v1/catalog/imagenes/') ? new URL(value, env.apiBaseUrl).href : value;
}
export function listImageProducts(page: number, signal?: AbortSignal): Promise<ImagePage> {
  return request(`/v1/catalog/admin/imagenes/productos?page=${page}`, { signal });
}
export function uploadProductImage(id: string, file: File, signal?: AbortSignal): Promise<ImageProduct> {
  const data = new FormData(); data.append('imagen', file);
  return request(`/v1/catalog/productos/${encodeURIComponent(id)}/imagen`, { method: 'POST', body: data, signal });
}
