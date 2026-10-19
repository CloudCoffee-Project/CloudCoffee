// src/utils/sesionCajero.test.ts
//
// Pruebas de la detección de "cajero sin cafetería asignada" (INT4-96). Función
// pura: decide si la app debe mostrar la pantalla de sesión sin cafetería en
// lugar de las pestañas del POS.

import { cajeroSinCafeteria } from './sesionCajero';
import type { SesionDecodificada } from '../types/domain';

function sesion(parcial: Partial<SesionDecodificada>): SesionDecodificada {
  return {
    userId: 'u-1',
    rol: 'cajero',
    cafeteriaId: 'c-1',
    exp: 0,
    ...parcial,
  };
}

describe('cajeroSinCafeteria', () => {
  it('detecta al cajero con cafetería asignada como operable', () => {
    expect(cajeroSinCafeteria(sesion({ rol: 'cajero', cafeteriaId: 'c-1' }))).toBe(false);
  });

  it('detecta al cajero sin cafetería (token sin claim) como bloqueado', () => {
    expect(cajeroSinCafeteria(sesion({ rol: 'cajero', cafeteriaId: null }))).toBe(true);
  });

  it('no bloquea al cliente aunque no traiga cafeteriaId (usa el campus)', () => {
    expect(cajeroSinCafeteria(sesion({ rol: 'cliente', cafeteriaId: null }))).toBe(false);
  });

  it('no bloquea roles administrativos', () => {
    expect(cajeroSinCafeteria(sesion({ rol: 'admin_cafeteria', cafeteriaId: null }))).toBe(false);
    expect(cajeroSinCafeteria(sesion({ rol: 'super_admin', cafeteriaId: null }))).toBe(false);
  });

  it('sin sesión no bloquea (la navegación manda a login)', () => {
    expect(cajeroSinCafeteria(null)).toBe(false);
    expect(cajeroSinCafeteria(undefined)).toBe(false);
  });
});
