import type { UserRole } from '../utils/jwt';
import { request } from './httpClient';
import { getProfile, type Profile } from './profile';

export type AdminSectionKey =
  | 'resumen'
  | 'cafeteria'
  | 'personal'
  | 'ofertas'
  | 'inventario'
  | 'ventas'
  | 'cafeterias'
  | 'usuarios'
  | 'catalogo';

export interface AdminNavItem {
  key: AdminSectionKey;
  label: string;
  path: string;
  description: string;
  operationalActionLabel: string;
}

export interface CafeteriaInventorySummaryItem {
  id: string;
  productoId: string;
  productoNombre: string;
  precio: number;
  stock: number;
  estado: string;
}

export interface VerifiedAdminContext {
  profile: Profile;
  role: 'ADMIN_CAFETERIA' | 'SUPER_ADMIN';
  cafeteriaId: string | null;
  inventoryCount: number | null;
  permissions: AdminNavItem[];
}

export const ADMIN_CAFETERIA_NAV_ITEMS: AdminNavItem[] = [
  {
    key: 'cafeteria',
    label: 'Mi Cafetería',
    path: '/admin/cafeteria',
    description: 'Consulta y actualiza el estado operativo (abierta, cerrada o en mantenimiento) de tu cafetería asignada.',
    operationalActionLabel: 'Configurar estado operativo',
  },
  {
    key: 'personal',
    label: 'Personal (Cajeros)',
    path: '/admin/personal',
    description: 'Lista, invita, edita y desactiva cajeros asignados exclusivamente a tu cafetería.',
    operationalActionLabel: 'Gestionar cajeros de la cafetería',
  },
  {
    key: 'ofertas',
    label: 'Ofertas y Precios',
    path: '/admin/ofertas',
    description: 'Crea ofertas para tu cafetería, actualiza precios y administra bajas o reactivaciones.',
    operationalActionLabel: 'Administrar ofertas de la cafetería',
  },
  {
    key: 'inventario',
    label: 'Inventario y Stock',
    path: '/admin/inventario',
    description: 'Consulta disponibilidad vendible y registra ajustes auditados de stock para tu cafetería.',
    operationalActionLabel: 'Registrar ajuste de stock',
  },
  {
    key: 'ventas',
    label: 'Ventas de Cafetería',
    path: '/admin/ventas',
    description: 'Revisa el resumen e historial de órdenes pagadas y entregadas de tu cafetería.',
    operationalActionLabel: 'Consultar ventas de la cafetería',
  },
];

export const SUPER_ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    key: 'cafeterias',
    label: 'Cafeterías y Campus',
    path: '/superadmin/cafeterias',
    description: 'Administra el alta, edición, baja lógica y reactivación de campus y cafeterías de la plataforma.',
    operationalActionLabel: 'Administrar cafeterías y campus',
  },
  {
    key: 'usuarios',
    label: 'Usuarios y Administradores',
    path: '/superadmin/usuarios',
    description: 'Busca cuentas globales, invita administradores o cajeros y gestiona asignaciones por cafetería.',
    operationalActionLabel: 'Gestionar cuentas y asignaciones',
  },
  {
    key: 'catalogo',
    label: 'Catálogo Maestro',
    path: '/superadmin/catalogo',
    description: 'Mantiene categorías y productos del catálogo maestro disponibles para todas las cafeterías.',
    operationalActionLabel: 'Administrar catálogo maestro',
  },
  {
    key: 'ventas',
    label: 'Ventas Globales',
    path: '/superadmin/ventas',
    description: 'Consulta ventas e indicadores consolidados filtrando por campus, cafetería, fechas y estado.',
    operationalActionLabel: 'Consultar ventas globales',
  },
];

export function getAdminNavItemsForRole(role: UserRole | null): AdminNavItem[] {
  if (role === 'ADMIN_CAFETERIA') {
    return ADMIN_CAFETERIA_NAV_ITEMS;
  }
  if (role === 'SUPER_ADMIN') {
    return SUPER_ADMIN_NAV_ITEMS;
  }
  return [];
}

export function getDefaultHomePathForRole(role: UserRole | null): { path: string; label: string } {
  switch (role) {
    case 'CAJERO':
      return { path: '/cajero', label: 'Ir al panel de cajero' };
    case 'ADMIN_CAFETERIA':
      return { path: '/admin', label: 'Ir al panel de administración' };
    case 'SUPER_ADMIN':
      return { path: '/superadmin', label: 'Ir al panel de superadministración' };
    default:
      return { path: '/catalogo', label: 'Ir al catálogo' };
  }
}

export async function verifyAdminContext(
  expectedRole: 'ADMIN_CAFETERIA' | 'SUPER_ADMIN',
  cafeteriaId: string | null,
  signal: AbortSignal,
): Promise<VerifiedAdminContext> {
  const profile = await getProfile(signal);

  if (expectedRole === 'SUPER_ADMIN') {
    return {
      profile,
      role: 'SUPER_ADMIN',
      cafeteriaId: null,
      inventoryCount: null,
      permissions: SUPER_ADMIN_NAV_ITEMS,
    };
  }

  const trimmedCafeteriaId = cafeteriaId?.trim() ?? '';
  if (!trimmedCafeteriaId) {
    return {
      profile,
      role: 'ADMIN_CAFETERIA',
      cafeteriaId: null,
      inventoryCount: null,
      permissions: [],
    };
  }

  const offers = await request<CafeteriaInventorySummaryItem[]>(
    `/v1/catalog/cafeterias/${encodeURIComponent(trimmedCafeteriaId)}/ofertas`,
    {
      method: 'GET',
      signal,
    },
  );

  return {
    profile,
    role: 'ADMIN_CAFETERIA',
    cafeteriaId: trimmedCafeteriaId,
    inventoryCount: Array.isArray(offers) ? offers.length : 0,
    permissions: ADMIN_CAFETERIA_NAV_ITEMS,
  };
}