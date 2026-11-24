import { ApiRequestError, request } from './httpClient';

export type SaleOrderStatus =
  | 'pagado'
  | 'listo_para_retiro'
  | 'entregado'
  | 'no_retirado_pendiente_revision'
  | 'no_retirado_final';

export type SaleStatusCategory = 'paid' | 'delivered' | 'uncollected' | 'cancelled';

export interface SaleItem {
  ordenId: string;
  compraId: string;
  codigoOrden: string;
  cafeteriaId: string;
  cafeteriaNombre: string;
  campusId: string | null;
  estado: SaleOrderStatus | string;
  montoTotal: number;
  moneda: string;
  cantidadItems: number;
  pagadoAt: string | null;
  entregadoAt: string | null;
}

export interface SalesPage {
  content: SaleItem[];
  number: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  empty: boolean;
}

export interface SalesStatusBreakdown {
  estado: SaleOrderStatus | string;
  ordenes: number;
  montoTotal: number;
}

export interface SalesCafeteriaBreakdown {
  cafeteriaId: string;
  cafeteriaNombre: string;
  ordenes: number;
  montoTotal: number;
}

export interface SalesSummary {
  desde: string;
  hasta: string;
  moneda: string;
  ordenes: number;
  montoTotal: number;
  porEstado: SalesStatusBreakdown[];
  porCafeteria: SalesCafeteriaBreakdown[];
}

export interface SaleOrderItem {
  ordenItemId: string;
  ofertaId: string;
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface SaleDetail {
  venta: SaleItem;
  items: SaleOrderItem[];
}

export interface SalesFilters {
  desde?: string;
  hasta?: string;
  estado?: string;
  page?: number;
  size?: number;
}

export const SANTIAGO_TIMEZONE = 'America/Santiago';

const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

const santiagoDateTimeFormatter = new Intl.DateTimeFormat('es-CL', {
  timeZone: SANTIAGO_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const santiagoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SANTIAGO_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const SALE_STATUS_OPTIONS: Array<{ value: SaleOrderStatus; label: string }> = [
  { value: 'pagado', label: 'Pagado (en preparación)' },
  { value: 'listo_para_retiro', label: 'Pagado · Listo para retiro' },
  { value: 'entregado', label: 'Entregado' },
  { value: 'no_retirado_pendiente_revision', label: 'No retirado (pendiente revisión)' },
  { value: 'no_retirado_final', label: 'No retirado (cerrado)' },
];

const STATUS_DISPLAY_MAP: Record<string, { label: string; category: SaleStatusCategory }> = {
  pagado: { label: 'Pagado', category: 'paid' },
  listo_para_retiro: { label: 'Listo para retiro', category: 'paid' },
  entregado: { label: 'Entregado', category: 'delivered' },
  no_retirado_pendiente_revision: {
    label: 'No retirado (pendiente revisión)',
    category: 'uncollected',
  },
  no_retirado_final: {
    label: 'No retirado (cerrado)',
    category: 'uncollected',
  },
  cancelado: {
    label: 'Cancelado (sin venta)',
    category: 'cancelled',
  },
};

export function describeSaleStatus(estado: string): {
  label: string;
  category: SaleStatusCategory;
} {
  return STATUS_DISPLAY_MAP[estado] ?? { label: estado, category: 'paid' };
}

export function formatClpAmount(amount: number): string {
  return clpFormatter.format(amount);
}

export function formatSantiagoDateTime(isoString: string | null | undefined): string {
  if (!isoString) {
    return 'Pendiente';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return santiagoDateTimeFormatter.format(date);
}

export function getDefaultSalesDateRange(now: Date = new Date()): {
  desde: string;
  hasta: string;
} {
  const hasta = santiagoDateFormatter.format(now);
  const [year, month, day] = hasta.split('-').map(Number);
  const startUtc = new Date(Date.UTC(year, month - 1, day));
  startUtc.setUTCDate(startUtc.getUTCDate() - 29);
  const desde = startUtc.toISOString().slice(0, 10);
  return { desde, hasta };
}

export function validateSalesDateRange(desde?: string, hasta?: string): string | null {
  const cleanDesde = desde?.trim() ?? '';
  const cleanHasta = hasta?.trim() ?? '';
  if (!cleanDesde && !cleanHasta) {
    return null;
  }

  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  if ((cleanDesde && !isoDatePattern.test(cleanDesde)) || (cleanHasta && !isoDatePattern.test(cleanHasta))) {
    return 'Las fechas deben tener el formato AAAA-MM-DD.';
  }

  if (cleanDesde && cleanHasta) {
    const startMs = Date.parse(`${cleanDesde}T00:00:00Z`);
    const endMs = Date.parse(`${cleanHasta}T00:00:00Z`);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return 'Las fechas ingresadas no son válidas.';
    }
    const diffDays = Math.round((endMs - startMs) / 86_400_000);
    if (diffDays < 0) {
      return 'La fecha "Desde" no puede ser posterior a la fecha "Hasta".';
    }
    if (diffDays >= 92) {
      return 'El rango de consulta no puede superar los 92 días inclusivos en America/Santiago.';
    }
  }

  return null;
}

export function formatSalesError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return 'No se pudo consultar el historial de ventas. Inténtalo nuevamente.';
  }

  switch (error.code) {
    case 'RANGO_VENTAS_INVALIDO':
      return 'El rango debe tener entre 1 y 92 días inclusivos en America/Santiago.';
    case 'ESTADO_INVALIDO':
      return 'El estado seleccionado no corresponde a un estado de venta válido.';
    case 'ASIGNACION_NO_AUTORIZADA':
    case 'ROL_NO_PERMITIDO':
      return 'No tienes autorización vigente para consultar las ventas de esta cafetería.';
    case 'ORDEN_NO_ENCONTRADA':
      return 'No se encontró la orden solicitada dentro de las ventas de tu cafetería.';
    default:
      if (error.errors.length > 0) {
        return error.errors.map((item) => item.message).join(' ');
      }
      return error.detail || 'Ocurrió un error al consultar las ventas.';
  }
}

function buildSalesFilterParams(filters: SalesFilters, includePagination: boolean): URLSearchParams {
  const params = new URLSearchParams();
  if (includePagination) {
    params.set('page', String(filters.page ?? 0));
    params.set('size', String(filters.size ?? 20));
  }
  if (filters.desde?.trim()) {
    params.set('desde', filters.desde.trim());
  }
  if (filters.hasta?.trim()) {
    params.set('hasta', filters.hasta.trim());
  }
  if (filters.estado?.trim()) {
    params.set('estado', filters.estado.trim());
  }
  return params;
}

export function getCafeteriaSales(
  filters: SalesFilters = {},
  signal?: AbortSignal,
): Promise<SalesPage> {
  const params = buildSalesFilterParams(filters, true);
  return request<SalesPage>(`/v1/orders/ventas?${params.toString()}`, {
    method: 'GET',
    signal,
  });
}

export function getCafeteriaSalesSummary(
  filters: SalesFilters = {},
  signal?: AbortSignal,
): Promise<SalesSummary> {
  const params = buildSalesFilterParams(filters, false);
  const query = params.toString();
  const url = query ? `/v1/orders/ventas/resumen?${query}` : '/v1/orders/ventas/resumen';
  return request<SalesSummary>(url, {
    method: 'GET',
    signal,
  });
}

export function getCafeteriaSaleDetail(
  ordenId: string,
  signal?: AbortSignal,
): Promise<SaleDetail> {
  return request<SaleDetail>(`/v1/orders/ventas/${encodeURIComponent(ordenId)}`, {
    method: 'GET',
    signal,
  });
}