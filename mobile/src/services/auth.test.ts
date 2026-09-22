// src/services/auth.test.ts
import { decodificarSesion, login, mapearRol } from './auth';
import { httpClient } from './httpClient';
import type { Rol } from '../types/domain';

function construirJwt(payload: Record<string, unknown>): string {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const base64 = btoa(String.fromCharCode(...json))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${base64}.signature`;
}

describe('mapearRol', () => {
  const casos: [unknown, Rol][] = [
    ['CAJERO', 'cajero'],
    ['cajero', 'cajero'],
    ['ADMIN_CAFETERIA', 'admin_cafeteria'],
    ['ADMIN', 'admin_cafeteria'],
    ['SUPER_ADMIN', 'super_admin'],
    ['CLIENTE', 'cliente'],
    ['CLIENT', 'cliente'],
    ['CONSUMIDOR', 'cliente'],
    [undefined, 'cliente'],
    ['ROL_DESCONOCIDO', 'cliente'],
  ];

  it.each(casos)('mapea %p -> %s', (crudo, esperado) => {
    expect(mapearRol(crudo)).toBe(esperado);
  });
});

describe('decodificarSesion', () => {
  it('construye la sesión desde el payload del JWT', () => {
    const token = construirJwt({ sub: 'u-1', rol: 'CAJERO', cafeteriaId: 'c-1', exp: 1760000000 });

    expect(decodificarSesion(token)).toEqual({
      userId: 'u-1',
      rol: 'cajero',
      cafeteriaId: 'c-1',
      exp: 1760000000,
    });
  });

  it('devuelve null ante un JWT inválido', () => {
    expect(decodificarSesion('no-es-un-jwt')).toBeNull();
  });

  it('devuelve null si el payload no trae usuario', () => {
    const token = construirJwt({ rol: 'CLIENTE' });
    expect(decodificarSesion(token)).toBeNull();
  });

  it('usa el rol por defecto cliente y cafeteriaId null cuando no vienen', () => {
    const token = construirJwt({ sub: 'u-2' });

    expect(decodificarSesion(token)).toEqual({
      userId: 'u-2',
      rol: 'cliente',
      cafeteriaId: null,
      exp: 0,
    });
  });
});

describe('login', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a /v1/auth/login con las credenciales normalizadas', async () => {
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({
      data: { accessToken: 'a', refreshToken: 'r' },
    });

    await login({ email: '  USUARIO@UCT.CL  ', password: 'secreto' });

    expect(postSpy).toHaveBeenCalledWith('/v1/auth/login', {
      email: 'usuario@uct.cl',
      password: 'secreto',
    });
  });
});
