import { type SpringPage } from './cafeteriaAdmin';
import { ApiRequestError, request } from './httpClient';

export interface CategoryAdminItem {
  categoriaId: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  version: number;
}

export interface ProductAdminItem {
  productoId: string;
  categoriaId: string;
  nombre: string;
  descripcion: string | null;
  imagenUrl: string | null;
  activo: boolean;
  version: number;
}

export interface CategoryListFilters {
  activo?: boolean;
  page?: number;
  size?: number;
}

export interface ProductListFilters {
  categoriaId?: string;
  q?: string;
  activo?: boolean;
  page?: number;
  size?: number;
}

export interface CreateCategoryInput {
  nombre: string;
  descripcion?: string;
}

export interface UpdateCategoryInput {
  nombre?: string;
  descripcion?: string;
  version: number;
}

export interface CreateProductInput {
  categoriaId: string;
  nombre: string;
  descripcion?: string;
  imagenUrl?: string;
}

export interface UpdateProductInput {
  categoriaId?: string;
  nombre?: string;
  descripcion?: string;
  imagenUrl?: string;
  version: number;
}

export type CategoryFieldErrors = Partial<Record<'nombre' | 'descripcion', string>>;
export type ProductFieldErrors = Partial<
  Record<'categoriaId' | 'nombre' | 'descripcion' | 'imagenUrl', string>
>;

export function createCatalogIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function isValidHttpsImageUrl(rawValue: string): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed) return true;
  if (trimmed.length > 255) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function validateCategoryForm(input: {
  nombre: string;
  descripcion: string;
}): CategoryFieldErrors {
  const errors: CategoryFieldErrors = {};
  const nombre = input.nombre.trim();
  const descripcion = input.descripcion.trim();

  if (!nombre) {
    errors.nombre = 'El nombre de la categoría es obligatorio.';
  } else if (nombre.length > 100) {
    errors.nombre = 'El nombre de la categoría no puede superar los 100 caracteres.';
  }

  if (descripcion.length > 500) {
    errors.descripcion = 'La descripción no puede superar los 500 caracteres.';
  }

  return errors;
}

export function validateProductForm(input: {
  categoriaId: string;
  nombre: string;
  descripcion: string;
  imagenUrl: string;
}): ProductFieldErrors {
  const errors: ProductFieldErrors = {};
  const categoriaId = input.categoriaId.trim();
  const nombre = input.nombre.trim();
  const descripcion = input.descripcion.trim();
  const imagenUrl = input.imagenUrl.trim();

  if (!categoriaId) {
    errors.categoriaId = 'Debes seleccionar una categoría activa.';
  }

  if (!nombre) {
    errors.nombre = 'El nombre del producto es obligatorio.';
  } else if (nombre.length > 150) {
    errors.nombre = 'El nombre del producto no puede superar los 150 caracteres.';
  }

  if (descripcion.length > 1000) {
    errors.descripcion = 'La descripción no puede superar los 1000 caracteres.';
  }

  if (imagenUrl && !isValidHttpsImageUrl(imagenUrl)) {
    errors.imagenUrl = 'La imagen debe ser una URL HTTPS válida de hasta 255 caracteres.';
  }

  return errors;
}

export function validateProductSearchQuery(rawQuery: string): string | null {
  const trimmed = rawQuery.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length < 2) {
    return 'Ingresa al menos 2 caracteres para buscar productos.';
  }
  if (trimmed.length > 100) {
    return 'La búsqueda no puede superar los 100 caracteres.';
  }
  return null;
}

export function extractCatalogFieldErrors<TField extends string>(
  error: unknown,
  allowedFields: readonly TField[],
): Partial<Record<TField, string>> {
  const fieldErrors: Partial<Record<TField, string>> = {};
  if (!(error instanceof ApiRequestError)) {
    return fieldErrors;
  }

  const allowedSet = new Set<string>(allowedFields);
  for (const item of error.errors) {
    if (allowedSet.has(item.field) && !fieldErrors[item.field as TField]) {
      fieldErrors[item.field as TField] = item.message;
    }
  }

  if (error.code === 'NOMBRE_DUPLICADO' && allowedSet.has('nombre') && !fieldErrors['nombre' as TField]) {
    fieldErrors['nombre' as TField] = 'Ya existe un registro con ese nombre en el catálogo.';
  }

  if (
    error.type === '/problems/imagen-url-invalida' &&
    allowedSet.has('imagenUrl') &&
    !fieldErrors['imagenUrl' as TField]
  ) {
    fieldErrors['imagenUrl' as TField] =
      error.detail || 'La imagen debe ser una URL HTTPS válida de hasta 255 caracteres.';
  }

  if (
    error.type === '/problems/nombre-invalido' &&
    allowedSet.has('nombre') &&
    !fieldErrors['nombre' as TField]
  ) {
    fieldErrors['nombre' as TField] = error.detail || 'El nombre ingresado no es válido.';
  }

  if (
    error.type === '/problems/texto-invalido' &&
    allowedSet.has('descripcion') &&
    !fieldErrors['descripcion' as TField]
  ) {
    fieldErrors['descripcion' as TField] = error.detail || 'La descripción ingresada no es válida.';
  }

  if (
    error.code === 'PRODUCTO_INACTIVO' &&
    allowedSet.has('categoriaId') &&
    !fieldErrors['categoriaId' as TField]
  ) {
    fieldErrors['categoriaId' as TField] =
      'La categoría seleccionada está inactiva. Elige una categoría activa.';
  }

  return fieldErrors;
}

export function formatCatalogAdminError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return 'No fue posible completar la operación con el servidor. Inténtalo nuevamente.';
  }

  if (error.status === 403 || error.code === 'ROL_NO_PERMITIDO') {
    return 'No tienes permisos vigentes de superadministrador para administrar el catálogo maestro.';
  }

  switch (error.code) {
    case 'NOMBRE_DUPLICADO':
      return 'Ya existe un registro con ese nombre en el catálogo maestro.';
    case 'VERSION_CONFLICTO':
      return 'Los datos cambiaron en el servidor por otra operación. Se actualizaron los datos; revisa e inténtalo nuevamente.';
    case 'CATEGORIA_EN_USO':
      return 'No se puede dar de baja la categoría porque contiene productos activos. Da de baja o reasigna esos productos primero.';
    case 'PRODUCTO_INACTIVO':
      return (
        error.detail ||
        'La categoría asociada está inactiva. Reactiva la categoría o elige otra categoría activa.'
      );
    case 'IDEMPOTENCY_CONFLICT':
      return 'La clave de envío ya se usó con datos distintos. Inténtalo nuevamente.';
    case 'IDEMPOTENCY_KEY_INVALIDA':
      return 'La clave de idempotencia no es válida. Inténtalo nuevamente.';
    default:
      if (error.errors.length > 0) {
        return error.errors.map((item) => item.message).join(' ');
      }
      return error.detail || 'Ocurrió un error al procesar la solicitud.';
  }
}

export function listAdminCategories(
  filters: CategoryListFilters = {},
  signal?: AbortSignal,
): Promise<SpringPage<CategoryAdminItem>> {
  const params = new URLSearchParams({
    page: String(filters.page ?? 0),
    size: String(filters.size ?? 20),
  });
  if (typeof filters.activo === 'boolean') {
    params.set('activo', String(filters.activo));
  }
  return request<SpringPage<CategoryAdminItem>>(
    `/v1/catalog/admin/categorias?${params.toString()}`,
    {
      method: 'GET',
      signal,
    },
  );
}

export function createAdminCategory(
  input: CreateCategoryInput,
  idempotencyKey: string,
): Promise<CategoryAdminItem> {
  const body: Record<string, string> = {
    nombre: input.nombre.trim(),
  };
  const descripcion = input.descripcion?.trim();
  if (descripcion) {
    body.descripcion = descripcion;
  }

  return request<CategoryAdminItem>('/v1/catalog/admin/categorias', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

export function updateAdminCategory(
  categoriaId: string,
  input: UpdateCategoryInput,
): Promise<CategoryAdminItem> {
  const body: Record<string, string | number> = {
    version: input.version,
  };
  if (input.nombre !== undefined) {
    body.nombre = input.nombre.trim();
  }
  const descripcion = input.descripcion?.trim();
  if (descripcion) {
    body.descripcion = descripcion;
  }

  return request<CategoryAdminItem>(
    `/v1/catalog/admin/categorias/${encodeURIComponent(categoriaId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
}

export function deactivateAdminCategory(categoriaId: string): Promise<CategoryAdminItem> {
  return request<CategoryAdminItem>(
    `/v1/catalog/admin/categorias/${encodeURIComponent(categoriaId)}/baja`,
    {
      method: 'POST',
    },
  );
}

export function reactivateAdminCategory(categoriaId: string): Promise<CategoryAdminItem> {
  return request<CategoryAdminItem>(
    `/v1/catalog/admin/categorias/${encodeURIComponent(categoriaId)}/reactivar`,
    {
      method: 'POST',
    },
  );
}

export function listAdminProducts(
  filters: ProductListFilters = {},
  signal?: AbortSignal,
): Promise<SpringPage<ProductAdminItem>> {
  const params = new URLSearchParams({
    page: String(filters.page ?? 0),
    size: String(filters.size ?? 20),
  });
  if (filters.categoriaId?.trim()) {
    params.set('categoriaId', filters.categoriaId.trim());
  }
  if (filters.q?.trim()) {
    params.set('q', filters.q.trim());
  }
  if (typeof filters.activo === 'boolean') {
    params.set('activo', String(filters.activo));
  }
  return request<SpringPage<ProductAdminItem>>(
    `/v1/catalog/admin/productos?${params.toString()}`,
    {
      method: 'GET',
      signal,
    },
  );
}

export function createAdminProduct(
  input: CreateProductInput,
  idempotencyKey: string,
): Promise<ProductAdminItem> {
  const body: Record<string, string> = {
    categoriaId: input.categoriaId.trim(),
    nombre: input.nombre.trim(),
  };
  const descripcion = input.descripcion?.trim();
  if (descripcion) {
    body.descripcion = descripcion;
  }
  const imagenUrl = input.imagenUrl?.trim();
  if (imagenUrl) {
    body.imagenUrl = imagenUrl;
  }

  return request<ProductAdminItem>('/v1/catalog/admin/productos', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

export function updateAdminProduct(
  productoId: string,
  input: UpdateProductInput,
): Promise<ProductAdminItem> {
  const body: Record<string, string | number> = {
    version: input.version,
  };
  if (input.categoriaId !== undefined && input.categoriaId.trim()) {
    body.categoriaId = input.categoriaId.trim();
  }
  if (input.nombre !== undefined) {
    body.nombre = input.nombre.trim();
  }
  const descripcion = input.descripcion?.trim();
  if (descripcion) {
    body.descripcion = descripcion;
  }
  const imagenUrl = input.imagenUrl?.trim();
  if (imagenUrl) {
    body.imagenUrl = imagenUrl;
  }

  return request<ProductAdminItem>(
    `/v1/catalog/admin/productos/${encodeURIComponent(productoId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
}

export function deactivateAdminProduct(productoId: string): Promise<ProductAdminItem> {
  return request<ProductAdminItem>(
    `/v1/catalog/admin/productos/${encodeURIComponent(productoId)}/baja`,
    {
      method: 'POST',
    },
  );
}

export function reactivateAdminProduct(productoId: string): Promise<ProductAdminItem> {
  return request<ProductAdminItem>(
    `/v1/catalog/admin/productos/${encodeURIComponent(productoId)}/reactivar`,
    {
      method: 'POST',
    },
  );
}
