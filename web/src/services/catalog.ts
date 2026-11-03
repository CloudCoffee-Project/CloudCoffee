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

export interface ProductDetail {
  id: string;
  nombre: string;
  descripcion: string | null;
  imagenUrl: string | null;
  categoria: Category;
}

export interface ProductOffer {
  id: string;
  cafeteriaId: string;
  cafeteriaName: string;
  price: number;
  stock: number;
  disponible: boolean;
}

export interface CartItem {
  offerId: string;
  productId: string;
  productName: string;
  cafeteriaId: string;
  cafeteriaName: string;
  price: number;
  quantity: number;
  stock: number;
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

export const CART_STORAGE_KEY = 'cartItems';
export const CART_UPDATED_EVENT = 'cart:change';

export function getCampus(signal: AbortSignal) {
  return request<Campus[]>('/v1/catalog/campus', { signal, omitAccessToken: true });
}

export function getCategories(signal: AbortSignal) {
  return request<Category[]>('/v1/catalog/categorias', { signal, omitAccessToken: true });
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
  return request<ProductPage>(`/v1/catalog/productos?${params}`, { signal, omitAccessToken: true });
}

export function getProductById(productId: string, signal: AbortSignal) {
  return request<ProductDetail>(
    `/v1/catalog/productos/${encodeURIComponent(productId)}`,
    { signal, omitAccessToken: true },
  );
}

export function getProductOffers(productId: string, campusId: string, signal: AbortSignal) {
  const params = new URLSearchParams({ campusId });
  return request<ProductOffer[]>(
    `/v1/catalog/productos/${encodeURIComponent(productId)}/ofertas?${params}`,
    { signal, omitAccessToken: true },
  );
}

export function readCartItems(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function addOfferToCart(product: ProductDetail, offer: ProductOffer, quantity = 1): CartItem | null {
  const requested = Math.floor(quantity);
  if (!offer.disponible || offer.stock <= 0 || requested <= 0) {
    return null;
  }

  const items = readCartItems();
  const index = items.findIndex((item) => item.offerId === offer.id);
  const currentQty = index >= 0 ? items[index].quantity : 0;
  const nextQty = Math.min(currentQty + requested, offer.stock);

  const updatedItem: CartItem = {
    offerId: offer.id,
    productId: product.id,
    productName: product.nombre,
    cafeteriaId: offer.cafeteriaId,
    cafeteriaName: offer.cafeteriaName,
    price: Number(offer.price),
    quantity: nextQty,
    stock: offer.stock,
  };

  const nextItems = index >= 0
    ? items.map((item, idx) => (idx === index ? updatedItem : item))
    : [...items, updatedItem];

  localStorage.setItem?.(CART_STORAGE_KEY, JSON.stringify(nextItems));
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  }

  return updatedItem;
}