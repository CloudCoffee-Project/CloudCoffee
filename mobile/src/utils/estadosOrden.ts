// src/utils/estadosOrden.ts
//
// Único mapa de presentación de los estados de orden (INT4-97). Cada estado del
// contrato del backend tiene acá su etiqueta y sus colores; ninguna pantalla
// vuelve a definir un badge/pill propio ni un string de estado suelto.
//
// El tipo `Record<EstadoOrden, ...>` obliga al compilador a exigir una entrada
// por cada valor del union: si el contrato agrega o quita un estado, este mapa
// deja de compilar hasta actualizarse. El test de este archivo verifica además
// que las claves coincidan exactamente con ESTADOS_ORDEN (contrato).

import type { EstadoOrden } from '../types/domain';

export interface EstadoOrdenVisual {
  etiqueta: string;
  fondo: string;
  texto: string;
}

export const ESTADOS_ORDEN_VISUAL: Record<EstadoOrden, EstadoOrdenVisual> = {
  revision_requerida: {
    etiqueta: '🟡 Requiere revisión',
    fondo: '#FEF3C7',
    texto: '#92400E',
  },
  pendiente_pago: {
    etiqueta: '⏳ Pendiente de pago',
    fondo: '#FEF3C7',
    texto: '#92400E',
  },
  pagado: {
    etiqueta: '🔵 Pagado',
    fondo: '#DBEAFE',
    texto: '#1E40AF',
  },
  listo_para_retiro: {
    etiqueta: '🟢 Listo para Retiro',
    fondo: '#DCFCE7',
    texto: '#166534',
  },
  entregado: {
    etiqueta: '⚪ Entregado',
    fondo: '#F3F4F6',
    texto: '#6B7280',
  },
  no_retirado_pendiente_revision: {
    etiqueta: '⚠️ No Retirado · Revisión',
    fondo: '#FEF3C7',
    texto: '#92400E',
  },
  no_retirado_final: {
    etiqueta: '⚠️ No Retirado',
    fondo: '#FEE2E2',
    texto: '#991B1B',
  },
  cancelado: {
    etiqueta: '⚪ Cancelado',
    fondo: '#F3F4F6',
    texto: '#6B7280',
  },
};

// Presentación de un estado concreto. El parámetro es EstadoOrden, así que no
// hay camino para pedir un estado que no exista en el contrato.
export function visualEstadoOrden(estado: EstadoOrden): EstadoOrdenVisual {
  return ESTADOS_ORDEN_VISUAL[estado];
}

// Atajo para quien solo necesita la etiqueta (chips de filtro, textos).
export function etiquetaEstadoOrden(estado: EstadoOrden): string {
  return ESTADOS_ORDEN_VISUAL[estado].etiqueta;
}
