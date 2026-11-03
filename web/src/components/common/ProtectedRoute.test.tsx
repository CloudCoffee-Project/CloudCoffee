// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { AuthProvider } from '../../contexts/AuthContext';
import { UserRole } from '../../utils/jwt';

function createTestJwt(payload: { sub?: string; role?: UserRole | string; exp?: number; cafeteriaId?: string }): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(
    JSON.stringify({
      sub: payload.sub ?? '11111111-1111-4111-8111-111111111111',
      role: payload.role ?? 'CLIENTE',
      exp: payload.exp ?? Math.floor(Date.now() / 1000) + 900,
      ...(payload.cafeteriaId ? { cafeteriaId: payload.cafeteriaId } : {}),
    }),
  );
  return `${header}.${body}.firma-verificada-en-backend`;
}

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('protección de rutas web según sesión y rol (INT2-94)', () => {
  it.each(['/compras', '/cajero', '/perfil'])(
    'redirige a /login cuando un usuario sin sesión intenta acceder a %s',
    (protectedPath) => {
      renderAppAt(protectedPath);

      expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeTruthy();
    },
  );

  it('limpia un token vencido y redirige a /login', () => {
    const expiredToken = createTestJwt({
      role: 'CLIENTE',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    localStorage.setItem('accessToken', expiredToken);

    renderAppAt('/compras');

    expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeTruthy();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('permite a CLIENTE acceder a /compras pero restringe el acceso a /cajero', () => {
    localStorage.setItem('accessToken', createTestJwt({ role: 'CLIENTE' }));

    renderAppAt('/compras');
    expect(screen.getByRole('heading', { name: 'Mis Compras' })).toBeTruthy();

    cleanup();

    renderAppAt('/cajero');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Panel de Cajero' })).toBeNull();
  });

  it('permite a CAJERO acceder a /cajero pero restringe el acceso a /compras', () => {
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'CAJERO',
        cafeteriaId: '22222222-2222-4222-8222-222222222222',
      }),
    );

    renderAppAt('/cajero');
    expect(screen.getByRole('heading', { name: 'Panel de Cajero' })).toBeTruthy();

    cleanup();

    renderAppAt('/compras');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Mis Compras' })).toBeNull();
  });
});
