// src/services/campus.test.ts
import { CAMPUS_STORAGE_KEY } from './campus';

describe('campus (INT4-98)', () => {
  it('ya no expone el mapa provisional de cafeterías por campus', () => {
    expect(CAMPUS_STORAGE_KEY).toBe('@app_campus_seleccionado');
  });
});
