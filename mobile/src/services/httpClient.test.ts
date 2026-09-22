// src/services/httpClient.test.ts
import { ApiError, getAccessToken, httpClient, setAccessToken, toApiError } from './httpClient';
import type { ApiProblem } from './httpClient';

describe('httpClient base (INT4-16)', () => {
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
