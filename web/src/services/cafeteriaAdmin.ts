import { ApiRequestError, request } from './httpClient';

export type CafeteriaOperationalStatus = 'OPEN' | 'CLOSED' | 'MAINTENANCE';

export interface CampusAdminItem {
  campusId: string;
  nombre: string;
  direccion: string | null;
  activo: boolean;
  bajaAt: string | null;
  version: number;
}

export interface CafeteriaAdminItem {
  cafeteriaId: string;
  campusId: string;
  nombre: string;
  estadoOperativo: CafeteriaOperationalStatus;
  activa: boolean;
  bajaAt: string | null;
  version: number;
}

export interface SpringPage<T> {
  content: T[];
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  empty?: boolean;
}

export interface CafeteriaListFilters {
  campusId?: string;
  activo?: boolean;
  page?: number;
  size?: number;
}

export interface CreateCafeteriaInput {
  campusId: string;
  nombre: string;
}

export interface UpdateCafeteriaInput {
  nombre: string;
  version: number;
}

export interface ChangeOperationalStatusInput {
  estadoOperativo: CafeteriaOperationalStatus;
  version: number;
}

export const OPERATIONAL_STATUS_LABELS: Record<CafeteriaOperationalStatus, string> = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
  MAINTENANCE: 'En mantenimiento',
};

export function formatOperationalStatus(status: CafeteriaOperationalStatus | string): string {
  if (status in OPERATIONAL_STATUS_LABELS) {
    return OPERATIONAL_STATUS_LABELS[status as CafeteriaOperationalStatus];
  }
  return status;
}

export function createAdminIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function validateCafeteriaName(rawName: string): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) {
    return 'El nombre de la cafetería es obligatorio.';
  }
  if (trimmed.length > 150) {
    return 'El nombre de la cafetería no puede superar los 150 caracteres.';
  }
  return null;
}

export function formatCafeteriaAdminError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return 'No fue posible completar la operación con el servidor. Inténtalo nuevamente.';
  }

  switch (error.code) {
    case 'NOMBRE_DUPLICADO':
      return 'Ya existe una cafetería con ese nombre en el campus seleccionado.';
    case 'VERSION_CONFLICTO':
      return 'Los datos cambiaron en el servidor por otra operación. Se actualizaron los datos; revisa e inténtalo nuevamente.';
    case 'CAFETERIA_DADA_DE_BAJA':
      return 'La cafetería se encuentra dada de baja y no admite cambios de estado operativo.';
    case 'CAMPUS_EN_USO':
      return 'El campus asociado está dado de baja o tiene restricciones activas que impiden la operación.';
    case 'ASIGNACION_NO_AUTORIZADA':
    case 'ROL_NO_PERMITIDO':
      return 'No tienes autorización vigente para ejecutar esta acción sobre la cafetería.';
    case 'OPERACION_PENDIENTE':
      return 'Una dependencia del sistema no está disponible temporalmente. Puedes reintentar conservando tus datos.';
    default:
      if (error.errors.length > 0) {
        return error.errors.map((item) => item.message).join(' ');
      }
      return error.detail || 'Ocurrió un error al procesar la solicitud.';
  }
}

export function listAdminCampuses(
  activo?: boolean,
  signal?: AbortSignal,
): Promise<SpringPage<CampusAdminItem>> {
  const params = new URLSearchParams({ page: '0', size: '100' });
  if (typeof activo === 'boolean') {
    params.set('activo', String(activo));
  }
  return request<SpringPage<CampusAdminItem>>(`/v1/catalog/admin/campus?${params.toString()}`, {
    method: 'GET',
    signal,
  });
}

export function listAdminCafeterias(
  filters: CafeteriaListFilters = {},
  signal?: AbortSignal,
): Promise<SpringPage<CafeteriaAdminItem>> {
  const params = new URLSearchParams({
    page: String(filters.page ?? 0),
    size: String(filters.size ?? 20),
  });
  if (filters.campusId?.trim()) {
    params.set('campusId', filters.campusId.trim());
  }
  if (typeof filters.activo === 'boolean') {
    params.set('activo', String(filters.activo));
  }
  return request<SpringPage<CafeteriaAdminItem>>(
    `/v1/catalog/admin/cafeterias?${params.toString()}`,
    {
      method: 'GET',
      signal,
    },
  );
}

export function createAdminCafeteria(
  input: CreateCafeteriaInput,
  idempotencyKey: string,
): Promise<CafeteriaAdminItem> {
  return request<CafeteriaAdminItem>('/v1/catalog/admin/cafeterias', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      campusId: input.campusId.trim(),
      nombre: input.nombre.trim(),
    }),
  });
}

export function updateAdminCafeteria(
  cafeteriaId: string,
  input: UpdateCafeteriaInput,
): Promise<CafeteriaAdminItem> {
  return request<CafeteriaAdminItem>(
    `/v1/catalog/admin/cafeterias/${encodeURIComponent(cafeteriaId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre: input.nombre.trim(),
        version: input.version,
      }),
    },
  );
}

export function deactivateAdminCafeteria(cafeteriaId: string): Promise<CafeteriaAdminItem> {
  return request<CafeteriaAdminItem>(
    `/v1/catalog/admin/cafeterias/${encodeURIComponent(cafeteriaId)}/baja`,
    {
      method: 'POST',
    },
  );
}

export function reactivateAdminCafeteria(cafeteriaId: string): Promise<CafeteriaAdminItem> {
  return request<CafeteriaAdminItem>(
    `/v1/catalog/admin/cafeterias/${encodeURIComponent(cafeteriaId)}/reactivar`,
    {
      method: 'POST',
    },
  );
}

export function getAssignedCafeteria(
  cafeteriaId: string,
  signal?: AbortSignal,
): Promise<CafeteriaAdminItem> {
  return request<CafeteriaAdminItem>(
    `/v1/catalog/cafeterias/${encodeURIComponent(cafeteriaId)}`,
    {
      method: 'GET',
      signal,
    },
  );
}

export function changeCafeteriaOperationalStatus(
  cafeteriaId: string,
  input: ChangeOperationalStatusInput,
): Promise<CafeteriaAdminItem> {
  return request<CafeteriaAdminItem>(
    `/v1/catalog/cafeterias/${encodeURIComponent(cafeteriaId)}/estado-operativo`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        estadoOperativo: input.estadoOperativo,
        version: input.version,
      }),
    },
  );
}