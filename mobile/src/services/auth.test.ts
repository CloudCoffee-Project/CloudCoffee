// src/services/auth.test.ts
import {
  actualizarPerfil,
  cambiarContrasena,
  CAMBIAR_PASSWORD_ENDPOINT,
  decodificarSesion,
  login,
  mapearRol,
  obtenerPerfil,
  PERFIL_ENDPOINT,
  reenviarVerificacion,
  registrar,
  restablecerPassword,
  solicitarRecuperacion,
  verificarCorreo,
} from './auth';
import { httpClient } from './httpClient';
import type { PerfilUsuario, Rol } from '../types/domain';

const perfilMock: PerfilUsuario = {
  id: 'uuid-1',
  email: 'ana.perez@uct.cl',
  nombre: 'Ana',
  apellido: 'Pérez',
  telefono: '+56 9 1234 5678',
  rol: 'CLIENTE',
  verificado: true,
};

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

describe('registrar', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a /v1/auth/register con los datos normalizados', async () => {
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({
      data: {
        id: 'uuid-1',
        email: 'usuario@uct.cl',
        nombre: 'Ana',
        apellido: 'Pérez',
        telefono: '+56 9 1234 5678',
        rol: 'CLIENTE',
        verificado: false,
      },
    });

    const resultado = await registrar({
      email: '  USUARIO@UCT.CL  ',
      password: 'secreto123',
      nombre: '  Ana  ',
      apellido: '  Pérez  ',
      telefono: ' +56 9 1234 5678 ',
    });

    expect(postSpy).toHaveBeenCalledWith('/v1/auth/register', {
      email: 'usuario@uct.cl',
      password: 'secreto123',
      nombre: 'Ana',
      apellido: 'Pérez',
      telefono: '+56 9 1234 5678',
    });
    expect(resultado).toEqual({
      id: 'uuid-1',
      email: 'usuario@uct.cl',
      nombre: 'Ana',
      apellido: 'Pérez',
      telefono: '+56 9 1234 5678',
      rol: 'CLIENTE',
      verificado: false,
    });
  });
});

describe('verificarCorreo', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a /v1/auth/verificacion con el token recortado', async () => {
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({
      data: { email: 'usuario@uct.cl', verificado: true },
    });

    const resultado = await verificarCorreo('  token-largo-inesperado  ');

    expect(postSpy).toHaveBeenCalledWith('/v1/auth/verificacion', {
      token: 'token-largo-inesperado',
    });
    expect(resultado).toEqual({ email: 'usuario@uct.cl', verificado: true });
  });
});

describe('reenviarVerificacion', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a /v1/auth/verificacion/reenviar con el email normalizado', async () => {
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: null });

    await reenviarVerificacion('  USUARIO@UCT.CL  ');

    expect(postSpy).toHaveBeenCalledWith('/v1/auth/verificacion/reenviar', {
      email: 'usuario@uct.cl',
    });
  });
});

describe('solicitarRecuperacion', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a /v1/auth/password/recovery con el email normalizado', async () => {
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: null });

    await solicitarRecuperacion('  USUARIO@UCT.CL  ');

    expect(postSpy).toHaveBeenCalledWith('/v1/auth/password/recovery', {
      email: 'usuario@uct.cl',
    });
  });
});

describe('restablecerPassword', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a /v1/auth/password/reset con token recortado y la clave nueva', async () => {
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: null });

    await restablecerPassword('  token-del-correo  ', 'nueva-clave-123');

    expect(postSpy).toHaveBeenCalledWith('/v1/auth/password/reset', {
      token: 'token-del-correo',
      nuevaPassword: 'nueva-clave-123',
    });
  });
});

describe('cambiarContrasena', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a /v1/auth/password/change con la contraseña actual y la nueva', async () => {
    const postSpy = jest.spyOn(httpClient, 'post').mockResolvedValue({ data: null });

    await cambiarContrasena({ passwordActual: 'vieja-123', nuevaPassword: 'nueva-12345' });

    expect(postSpy).toHaveBeenCalledWith(CAMBIAR_PASSWORD_ENDPOINT, {
      passwordActual: 'vieja-123',
      nuevaPassword: 'nueva-12345',
    });
  });
});

describe('obtenerPerfil', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a GET /v1/auth/me y devuelve el perfil del usuario', async () => {
    const getSpy = jest.spyOn(httpClient, 'get').mockResolvedValue({ data: perfilMock });

    const resultado = await obtenerPerfil();

    expect(getSpy).toHaveBeenCalledWith(PERFIL_ENDPOINT);
    expect(resultado).toEqual(perfilMock);
  });
});

describe('actualizarPerfil', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('llama a PUT /v1/auth/me normalizando nombre, apellido y teléfono', async () => {
    const putSpy = jest.spyOn(httpClient, 'put').mockResolvedValue({ data: perfilMock });

    const resultado = await actualizarPerfil({
      nombre: '  Ana  ',
      apellido: '  Pérez  ',
      telefono: ' +56 9 1234 5678 ',
    });

    expect(putSpy).toHaveBeenCalledWith(PERFIL_ENDPOINT, {
      nombre: 'Ana',
      apellido: 'Pérez',
      telefono: '+56 9 1234 5678',
    });
    expect(resultado).toEqual(perfilMock);
  });
});
