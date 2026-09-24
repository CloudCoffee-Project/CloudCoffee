// src/services/httpClient.test.ts
import {
  ApiError,
  clearTokens,
  decodeJwtExp,
  decodeJwtPayload,
  getAccessToken,
  getRefreshToken,
  httpClient,
  isAccessTokenExpired,
  onTokensCambiados,
  refreshAccessToken,
  setAccessToken,
  setRefreshToken,
  setTokens,
  toApiError,
} from './httpClient';
import type { ApiProblem } from './httpClient';
import { requestNewTokens } from './authRefresh';

jest.mock('./authRefresh', () => ({
  requestNewTokens: jest.fn(),
}));

const mockedRequestNewTokens = requestNewTokens as jest.Mock;

function construirJwt(payload: Record<string, unknown>): string {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const base64 = btoa(String.fromCharCode(...json))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${base64}.signature`;
}

describe('httpClient base (INT4-16)', () => {
  afterEach(() => {
    clearTokens();
    jest.clearAllMocks();
  });

  describe('setAccessToken / getAccessToken', () => {
    it('guarda y devuelve el token inyectado', () => {
      setAccessToken('token-ejemplo');
      expect(getAccessToken()).toBe('token-ejemplo');
    });

    it('limpia el token al pasar null', () => {
      setAccessToken('token-ejemplo');
      setAccessToken(null);
      expect(getAccessToken()).toBeNull();
    });
  });

  describe('instancia axios', () => {
    it('apunta al API Gateway como baseURL', () => {
      expect(httpClient.defaults.baseURL).toContain('18080');
    });
  });

  describe('normalización RFC 9457', () => {
    it('usa detail del problem+json como mensaje del ApiError', () => {
      const problem: ApiProblem = {
        type: 'about:blank',
        title: 'Conflicto',
        status: 409,
        detail: 'El correo ya está registrado.',
        instance: '/v1/auth/register',
        timestamp: '2026-09-22T00:00:00Z',
      };

      const error = new Error('Request failed with status code 409') as any;
      error.response = { status: 409, data: problem };

      const resultado = toApiError(error);
      expect(resultado).toBeInstanceOf(ApiError);
      expect(resultado.status).toBe(409);
      expect(resultado.message).toBe('El correo ya está registrado.');
      expect(resultado.problem?.instance).toBe('/v1/auth/register');
    });

    it('sin respuesta (red caída) devuelve ApiError con status 0', () => {
      const error = new Error('Network Error') as any;

      const resultado = toApiError(error);
      expect(resultado).toBeInstanceOf(ApiError);
      expect(resultado.status).toBe(0);
      expect(resultado.message).toBe('Network Error');
    });
  });
});

describe('par de tokens (INT4-17)', () => {
  afterEach(() => clearTokens());

  it('setTokens fija access y refresh token', () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(getAccessToken()).toBe('access-1');
    expect(getRefreshToken()).toBe('refresh-1');
  });

  it('setRefreshToken / getRefreshToken gestionan el refresh token', () => {
    setRefreshToken('refresh-x');
    expect(getRefreshToken()).toBe('refresh-x');
    setRefreshToken(null);
    expect(getRefreshToken()).toBeNull();
  });

  it('clearTokens limpia ambos tokens', () => {
    setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});

describe('decodeJwtPayload', () => {
  it('decodifica el payload completo de un JWT', () => {
    const token = construirJwt({ sub: 'u-1', rol: 'CAJERO', exp: 1760000000 });

    expect(decodeJwtPayload(token)).toEqual({ sub: 'u-1', rol: 'CAJERO', exp: 1760000000 });
  });

  it('devuelve null ante un JWT inválido', () => {
    expect(decodeJwtPayload('no-es-un-jwt')).toBeNull();
    expect(decodeJwtPayload('')).toBeNull();
  });
});

describe('decodeJwtExp', () => {
  it('decodifica el exp del payload de un JWT', () => {
    const payload = construirJwt({ exp: 1760000000 });
    const token = payload;

    expect(decodeJwtExp(token)).toBe(1760000000);
  });

  it('devuelve null si el token no tiene exp', () => {
    const payload = construirJwt({ sub: 'cliente-1' });
    const token = payload;

    expect(decodeJwtExp(token)).toBeNull();
  });

  it('devuelve null ante un JWT inválido', () => {
    expect(decodeJwtExp('no-es-un-jwt')).toBeNull();
    expect(decodeJwtExp('')).toBeNull();
  });
});

describe('isAccessTokenExpired', () => {
  it('retorna true si exp pasó', () => {
    const token = construirJwt({ exp: 1000000 });
    expect(isAccessTokenExpired(token, 2000000)).toBe(true);
  });

  it('retorna false si exp no venció', () => {
    const token = construirJwt({ exp: 2000000 });
    expect(isAccessTokenExpired(token, 1000000)).toBe(false);
  });

  it('retorna false si el token no tiene exp', () => {
    const token = construirJwt({ sub: 'cliente-1' });
    expect(isAccessTokenExpired(token, 1000000)).toBe(false);
  });
});

describe('refreshAccessToken (INT4-17)', () => {
  afterEach(() => {
    clearTokens();
    mockedRequestNewTokens.mockReset();
  });

  it('renueva el accessToken y actualiza los tokens', async () => {
    setTokens({ accessToken: 'access-viejo', refreshToken: 'refresh-viejo' });
    mockedRequestNewTokens.mockResolvedValue({
      accessToken: 'access-nuevo',
      refreshToken: 'refresh-nuevo',
    });

    const nuevo = await refreshAccessToken();

    expect(nuevo).toBe('access-nuevo');
    expect(getAccessToken()).toBe('access-nuevo');
    expect(getRefreshToken()).toBe('refresh-nuevo');
    expect(mockedRequestNewTokens).toHaveBeenCalledWith('refresh-viejo');
  });

  it('reutiliza la promesa en curso (cola single-flight)', async () => {
    setTokens({ accessToken: 'access-viejo', refreshToken: 'refresh-viejo' });
    mockedRequestNewTokens.mockResolvedValue({
      accessToken: 'access-nuevo',
    });

    const [a, b, c] = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    expect(mockedRequestNewTokens).toHaveBeenCalledTimes(1);
    expect(a).toBe('access-nuevo');
    expect(b).toBe('access-nuevo');
    expect(c).toBe('access-nuevo');
  });

  it('ante fallo limpia los tokens y devuelve null', async () => {
    setTokens({ accessToken: 'access-viejo', refreshToken: 'refresh-viejo' });
    mockedRequestNewTokens.mockRejectedValue(new Error('refresh inválido'));

    const resultado = await refreshAccessToken();

    expect(resultado).toBeNull();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('devuelve null sin refreshToken configurado', async () => {
    const resultado = await refreshAccessToken();
    expect(resultado).toBeNull();
    expect(mockedRequestNewTokens).not.toHaveBeenCalled();
  });
});

describe('onTokensCambiados (INT4-22)', () => {
  afterEach(() => {
    clearTokens();
    onTokensCambiados(() => undefined);
    jest.clearAllMocks();
  });

  it('notifica el par de tokens al hacer setTokens', () => {
    const listener = jest.fn();
    onTokensCambiados(listener);

    setTokens({ accessToken: 'access-nuevo', refreshToken: 'refresh-nuevo' });

    expect(listener).toHaveBeenCalledWith({
      accessToken: 'access-nuevo',
      refreshToken: 'refresh-nuevo',
    });
  });

  it('notifica null al limpiar los tokens', () => {
    const listener = jest.fn();
    onTokensCambiados(listener);
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    listener.mockClear();

    clearTokens();

    expect(listener).toHaveBeenCalledWith(null);
  });

  it('notifica los tokens renovados tras un refresh exitoso', async () => {
    const listener = jest.fn();
    onTokensCambiados(listener);
    setTokens({ accessToken: 'access-viejo', refreshToken: 'refresh-viejo' });
    listener.mockClear();

    mockedRequestNewTokens.mockResolvedValue({
      accessToken: 'access-nuevo',
      refreshToken: 'refresh-nuevo',
    });

    const resultado = await refreshAccessToken();

    expect(resultado).toBe('access-nuevo');
    expect(listener).toHaveBeenCalledWith({
      accessToken: 'access-nuevo',
      refreshToken: 'refresh-nuevo',
    });
  });

  it('no notifica cuando no hay listener registrado', () => {
    setTokens({ accessToken: 'a', refreshToken: 'r' });
    expect(() => clearTokens()).not.toThrow();
  });
});
