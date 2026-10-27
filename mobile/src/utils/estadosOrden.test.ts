// src/utils/estadosOrden.test.ts

import { ESTADOS_ORDEN } from '../types/domain';
import { ESTADOS_ORDEN_VISUAL, etiquetaEstadoOrden, visualEstadoOrden } from './estadosOrden';

describe('mapa único de estados de orden (INT4-97)', () => {
  it('tiene una entrada visual por cada estado del contrato', () => {
    expect(Object.keys(ESTADOS_ORDEN_VISUAL).sort()).toEqual([...ESTADOS_ORDEN].sort());
  });

  it('cada entrada tiene etiqueta, fondo y texto', () => {
    ESTADOS_ORDEN.forEach((estado) => {
      const visual = ESTADOS_ORDEN_VISUAL[estado];
      expect(typeof visual.etiqueta).toBe('string');
      expect(visual.etiqueta.length).toBeGreaterThan(0);
      expect(visual.fondo).toMatch(/^#/);
      expect(visual.texto).toMatch(/^#/);
    });
  });

  it('visualEstadoOrden y etiquetaEstadoOrden devuelven el mapa del contrato', () => {
    const estado = 'listo_para_retiro';
    expect(visualEstadoOrden(estado)).toBe(ESTADOS_ORDEN_VISUAL[estado]);
    expect(etiquetaEstadoOrden(estado)).toBe(ESTADOS_ORDEN_VISUAL[estado].etiqueta);
  });

  it('cubren los estados usados por el cajero (activos y no retirados)', () => {
    expect(ESTADOS_ORDEN_VISUAL.pagado.etiqueta).toBe('🔵 Pagado');
    expect(ESTADOS_ORDEN_VISUAL.listo_para_retiro.etiqueta).toBe('🟢 Listo para Retiro');
    expect(ESTADOS_ORDEN_VISUAL.no_retirado_pendiente_revision.etiqueta).toBe(
      '⚠️ No Retirado · Revisión'
    );
    expect(ESTADOS_ORDEN_VISUAL.no_retirado_final.etiqueta).toBe('⚠️ No Retirado');
  });
});
