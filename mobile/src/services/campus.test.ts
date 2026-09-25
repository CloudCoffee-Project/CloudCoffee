// src/services/campus.test.ts
import { cafeteriaIdDeCampus } from './campus';

describe('cafeteriaIdDeCampus', () => {
  it('mapea un campus conocido a su cafetería principal', () => {
    expect(cafeteriaIdDeCampus('san-juan-pablo-ii')).toBe('cafe-1');
    expect(cafeteriaIdDeCampus('san-francisco')).toBe('cafe-2');
    expect(cafeteriaIdDeCampus('norte')).toBe('cafe-3');
    expect(cafeteriaIdDeCampus('menchaca-lira')).toBe('cafe-4');
  });

  it('devuelve null sin campus o con campus desconocido', () => {
    expect(cafeteriaIdDeCampus(null)).toBeNull();
    expect(cafeteriaIdDeCampus(undefined)).toBeNull();
    expect(cafeteriaIdDeCampus('campus-futuro')).toBeNull();
  });
});
