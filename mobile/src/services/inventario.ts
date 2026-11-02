// src/services/inventario.ts
//
// Inventario de la cafetería del cajero (INT4-100). Es la única fuente de
// datos de la pantalla de stock: las pantallas nunca pegan httpClient ni
// definen sus propios DTOs.
//
// Contrato (catalog-service → StaffCatalogController):
//   GET /v1/catalog/cafeterias/{cafeteriaId}/ofertas
//
// Requiere JWT de CAJERO o ADMIN_CAFETERIA cuyo claim cafeteriaId coincida con
// la ruta (SUPER_ADMIN puede consultar cualquiera). Devuelve TODAS las ofertas
// de la cafetería, sin filtrar por estado, ordenadas por nombre de producto.
// Incluye las agotadas: la pantalla decide cómo mostrarlas.
//
// El gateway enruta /v1/catalog/** con StripPrefix=1, así que la ruta que ve la
// app es /v1/catalog/cafeterias/... (misma familia que services/catalog.ts).
//
// El stock en vivo NO viene de acá: llega por WebSocket y lo superpone el hook
// useCafeteriaStock sobre esta lista (ver la pantalla de stock).

import { httpClient } from './httpClient';
import { listarCampus } from './catalog';
import type { EstadoOferta, InventarioItem } from '../types/domain';

export const INVENTARIO_ENDPOINT = '/v1/catalog/cafeterias';

/** Ruta del inventario de una cafetería. */
export function inventarioEndpoint(cafeteriaId: string): string {
  return `${INVENTARIO_ENDPOINT}/${cafeteriaId}/ofertas`;
}

// CafeteriaInventoryItemResponse del catalog-service. `precio` es un BigDecimal
// y puede llegar como number o string según el serializador; se normaliza a
// número igual que en services/catalog.ts.
interface InventarioItemResponse {
  id: string;
  productoId: string;
  productoNombre: string;
  precio: number | string;
  stock: number;
  estado: string;
}

function mapearEstado(estado: string): EstadoOferta {
  // El backend solo devuelve estos dos valores (OfferStatus). Cualquier otro
  // valor se trata como disponible y, de todos modos, esOfertaAgotada mira
  // también el stock: no se inventa un estado nuevo en la app.
  return estado === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'AVAILABLE';
}

/** Traduce el DTO del backend al tipo de dominio. */
export function mapearInventarioItem(dto: InventarioItemResponse): InventarioItem {
  return {
    ofertaId: dto.id,
    productoId: dto.productoId,
    productoNombre: dto.productoNombre,
    precio: Number(dto.precio),
    stock: Number(dto.stock),
    estado: mapearEstado(dto.estado),
  };
}

/**
 * Llama a GET /v1/catalog/cafeterias/{cafeteriaId}/ofertas y devuelve el
 * inventario real de la cafetería, agotadas incluidas.
 */
export async function listarInventarioCafeteria(cafeteriaId: string): Promise<InventarioItem[]> {
  const response = await httpClient.get<InventarioItemResponse[]>(inventarioEndpoint(cafeteriaId));

  return response.data.map(mapearInventarioItem);
}

/**
 * Resuelve el nombre de la cafetería para el encabezado del POS.
 *
 * El endpoint de inventario no lo devuelve, pero GET /v1/catalog/campus sí
 * trae las cafeterías de cada campus. Es "mejor esfuerzo": si el catálogo no
 * responde, la pantalla muestra un nombre genérico en vez de romper el listado
 * de stock (que es lo importante de la pantalla).
 */
export async function obtenerNombreCafeteria(cafeteriaId: string): Promise<string | null> {
  try {
    const campus = await listarCampus();
    for (const item of campus) {
      const cafeteria = item.cafeterias?.find((c) => c.id === cafeteriaId);
      if (cafeteria) {
        return cafeteria.nombre;
      }
    }
    return null;
  } catch {
    return null;
  }
}
