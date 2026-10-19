// src/utils/avisarAdministrador.test.ts
//
// Pruebas de la acción "avisar al administrador" del cajero sin cafetería
// (INT4-96): el correo se arma y se abre con Linking sin endpoint nuevo.

import * as Linking from 'expo-linking';

import { ADMIN_EMAIL } from '../config/soporte';
import {
  ASUNTO_AVISO_ADMIN,
  avisarAlAdministrador,
  mensajeAvisoAdministrador,
} from './avisarAdministrador';

jest.mock('expo-linking', () => ({
  openURL: jest.fn(),
}));

const mockOpenURL = Linking.openURL as unknown as jest.Mock;

describe('mensajeAvisoAdministrador', () => {
  it('explica el problema y pide asignar una cafetería', () => {
    const mensaje = mensajeAvisoAdministrador();
    expect(mensaje).toContain('cafetería asignada');
    expect(mensaje).toContain('cerrar la sesión');
  });

  it('incluye el correo del cajero cuando se conoce', () => {
    expect(mensajeAvisoAdministrador('cajero@cloudcoffee.dev')).toContain('cajero@cloudcoffee.dev');
  });
});

describe('avisarAlAdministrador', () => {
  beforeEach(() => {
    mockOpenURL.mockReset();
  });

  it('abre un mailto con asunto y cuerpo pre-redactados', async () => {
    mockOpenURL.mockResolvedValue(true);

    await avisarAlAdministrador();

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    const url = mockOpenURL.mock.calls[0][0] as string;
    expect(url.startsWith(`mailto:${ADMIN_EMAIL}?`)).toBe(true);
    expect(decodeURIComponent(url)).toContain(ASUNTO_AVISO_ADMIN);
    expect(decodeURIComponent(url)).toContain('cafetería asignada');
  });

  it('propaga false cuando el dispositivo no puede abrir el correo', async () => {
    mockOpenURL.mockResolvedValue(false);

    await expect(avisarAlAdministrador()).resolves.toBe(false);
  });
});
