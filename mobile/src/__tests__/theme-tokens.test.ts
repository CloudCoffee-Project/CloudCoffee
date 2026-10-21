// src/__tests__/theme-tokens.test.ts
//
// INT4-104 — Integridad del sistema de tokens de diseño (src/theme/tokens.ts).
// El archivo es la base de todas las migraciones del sprint, así que estos
// tests vigilan que los valores sigan siendo válidos: colores en formato
// #RRGGBB, escalas sin pasos repetidos ni no numéricos, pesos de texto
// aceptados por React Native y sombras con sus propiedades completas.
// Si alguien agrega o edita un token y rompe una de estas reglas, el CI lo
// marca antes de que el error se propague a las pantallas.

import { colores, espaciado, radios, sombras, tipografia, tokens } from '../theme/tokens';

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

describe('punto de entrada tokens (INT4-104)', () => {
  it('expone las cinco categorías apuntando a las mismas definiciones', () => {
    expect(tokens.colores).toBe(colores);
    expect(tokens.tipografia).toBe(tipografia);
    expect(tokens.espaciado).toBe(espaciado);
    expect(tokens.radios).toBe(radios);
    expect(tokens.sombras).toBe(sombras);
  });
});
