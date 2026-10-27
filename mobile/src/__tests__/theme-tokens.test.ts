// src/__tests__/theme-tokens.test.ts
//
// INT4-104 — Integridad del sistema de tokens de diseño (src/theme/tokens.ts).
// El archivo es la base de todas las migraciones del sprint, así que estos
// tests vigilan que los valores sigan siendo válidos: colores en formato
// #RRGGBB, escalas sin pasos repetidos ni no numéricos, pesos de texto
// aceptados por React Native, sombras con sus propiedades completas y
// grosores/estados dentro de rangos usables.
// Si alguien agrega o edita un token y rompe una de estas reglas, el CI lo
// marca antes de que el error se propague a las pantallas.
// (Categorías nuevas en INT4-106: grosores y estados; en INT4-107: tamanos,
//  interlineado y tracking; en INT4-108: colores y opacidad de los esqueletos
//  de carga.)

import {
  colores,
  espaciado,
  estados,
  grosores,
  radios,
  sombras,
  tamanos,
  tipografia,
  tokens,
} from '../theme/tokens';

const HEX = /^#[0-9A-F]{6}$/;
const PESOS_RN = new Set(['100', '200', '300', '400', '500', '600', '700', '800', '900']);

describe('colores (INT4-104)', () => {
  it('todos los colores son hexadecimales de 6 dígitos en mayúsculas', () => {
    const invalidos = Object.entries(colores)
      .filter(([, valor]) => !HEX.test(valor))
      .map(([nombre, valor]) => `${nombre}: ${valor}`);

    expect(invalidos).toEqual([]);
  });
});

describe('espaciado (INT4-104)', () => {
  it('todos los pasos son enteros positivos', () => {
    for (const [nombre, valor] of Object.entries(espaciado)) {
      expect(Number.isInteger(valor)).toBe(true);
      expect(valor).toBeGreaterThan(0);
      expect(nombre).not.toBe('');
    }
  });

  it('no tiene pasos repetidos (cada token representa una medida única)', () => {
    const valores = Object.values(espaciado);
    expect(new Set(valores).size).toBe(valores.length);
  });
});

describe('radios (INT4-104)', () => {
  it('todos los radios son enteros positivos y únicos', () => {
    const valores = Object.values(radios);

    for (const valor of valores) {
      expect(Number.isInteger(valor)).toBe(true);
      expect(valor).toBeGreaterThan(0);
    }
    expect(new Set(valores).size).toBe(valores.length);
  });
});

describe('tamanos (INT4-107)', () => {
  it('los lados de componente son enteros positivos y únicos', () => {
    const valores = Object.values(tamanos);

    for (const valor of valores) {
      expect(Number.isInteger(valor)).toBe(true);
      expect(valor).toBeGreaterThan(0);
    }
    expect(new Set(valores).size).toBe(valores.length);
  });
});

describe('tipografía (INT4-104)', () => {
  it('los tamaños de texto son enteros positivos y únicos', () => {
    const valores = Object.values(tipografia.tamano);

    for (const valor of valores) {
      expect(Number.isInteger(valor)).toBe(true);
      expect(valor).toBeGreaterThan(0);
    }
    expect(new Set(valores).size).toBe(valores.length);
  });

  it('los pesos son aceptados por React Native', () => {
    for (const peso of Object.values(tipografia.peso)) {
      expect(PESOS_RN.has(peso)).toBe(true);
    }
  });

  it('los interlineados son enteros positivos y únicos (INT4-107)', () => {
    const valores = Object.values(tipografia.interlineado);

    for (const valor of valores) {
      expect(Number.isInteger(valor)).toBe(true);
      expect(valor).toBeGreaterThan(0);
    }
    expect(new Set(valores).size).toBe(valores.length);
  });

  it('el tracking es numérico, distinto de cero y único (INT4-107)', () => {
    const valores = Object.values(tipografia.tracking);

    for (const valor of valores) {
      expect(Number.isFinite(valor)).toBe(true);
      expect(valor).not.toBe(0);
    }
    expect(new Set(valores).size).toBe(valores.length);
  });

  it('los estilos combinados tienen tamaño y peso válidos', () => {
    for (const [nombre, estilo] of Object.entries(tipografia.texto)) {
      expect(Number.isInteger(estilo.fontSize)).toBe(true);
      expect(estilo.fontSize).toBeGreaterThan(0);
      expect(PESOS_RN.has(estilo.fontWeight)).toBe(true);
      expect(nombre).not.toBe('');
    }
  });
});

describe('sombras (INT4-104)', () => {
  it('cada nivel tiene opacidad entre 0 y 1, offset numérico y elevation', () => {
    for (const [nombre, sombra] of Object.entries(sombras)) {
      expect(sombra.shadowOpacity).toBeGreaterThanOrEqual(0);
      expect(sombra.shadowOpacity).toBeLessThanOrEqual(1);
      expect(Number.isFinite(sombra.shadowOffset.width)).toBe(true);
      expect(Number.isFinite(sombra.shadowOffset.height)).toBe(true);
      expect(Number.isInteger(sombra.elevation)).toBe(true);
      expect(sombra.elevation).toBeGreaterThanOrEqual(0);
      expect(nombre).not.toBe('');
    }
  });
});

describe('grosores (INT4-106)', () => {
  it('los grosores de borde son números positivos y únicos', () => {
    const valores = Object.values(grosores);

    for (const valor of valores) {
      expect(valor).toBeGreaterThan(0);
    }
    expect(new Set(valores).size).toBe(valores.length);
  });
});

describe('estados (INT4-106)', () => {
  it('todas las opacidades están estrictamente entre 0 y 1 y no se repiten', () => {
    const valores = Object.values(estados);

    for (const valor of valores) {
      expect(valor).toBeGreaterThan(0);
      expect(valor).toBeLessThan(1);
    }
    expect(new Set(valores).size).toBe(valores.length);
  });
});

describe('punto de entrada tokens (INT4-104)', () => {
  it('expone todas las categorías apuntando a las mismas definiciones', () => {
    expect(tokens.colores).toBe(colores);
    expect(tokens.tipografia).toBe(tipografia);
    expect(tokens.espaciado).toBe(espaciado);
    expect(tokens.tamanos).toBe(tamanos);
    expect(tokens.radios).toBe(radios);
    expect(tokens.sombras).toBe(sombras);
    expect(tokens.grosores).toBe(grosores);
    expect(tokens.estados).toBe(estados);
  });
});
