// src/services/campus.ts
//
// Resuelve la cafetería "actual" del cliente a partir del campus seleccionado
// (INT4-46). El backend todavía no expone cafeterías por campus; este mapeo es
// un contrato provisional en mobile hasta que el catálogo real lo entregue.

export const CAMPUS_STORAGE_KEY = '@app_campus_seleccionado';

// Ids de campus (ver src/app/(cliente)/campus.tsx y su CAMPUS_LISTA) → cafetería
// principal. Provisional: se ajusta cuando exista el endpoint de cafeterías.
const CAFETERIA_POR_CAMPUS: Record<string, string> = {
  'san-juan-pablo-ii': 'cafe-1',
  'san-francisco': 'cafe-2',
  norte: 'cafe-3',
  'menchaca-lira': 'cafe-4',
};

// Devuelve null cuando no hay campus seleccionado o el id no está mapeado.
export function cafeteriaIdDeCampus(campusId: string | null | undefined): string | null {
  if (!campusId) {
    return null;
  }
  return CAFETERIA_POR_CAMPUS[campusId] ?? null;
}
