// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { AuthProvider } from '../../contexts/AuthContext';
import { AUTH_SESSION_EVENT } from '../../services/httpClient';
import { UserRole } from '../../utils/jwt';

vi.mock('../../config/env', () => ({
  env: {
    appTitle: 'CloudCoffee',
    apiBaseUrl: 'http://localhost:18080',
  },
}));

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
  it.each(['/compras', '/cajero', '/admin', '/superadmin', '/perfil'])(
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
  it('recupera la sesión rotando el refresh token cuando el access token venció (INT2-93)', async () => {
    const expiredToken = createTestJwt({
      role: 'CLIENTE',
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const renewedToken = createTestJwt({
      role: 'CLIENTE',
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    localStorage.setItem('accessToken', expiredToken);
    localStorage.setItem('refreshToken', 'refresh-token-vigente');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accessToken: renewedToken,
          refreshToken: 'refresh-token-rotado',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderAppAt('/compras');

    expect(await screen.findByRole('heading', { name: 'Mis Compras' })).toBeTruthy();
    expect(localStorage.getItem('accessToken')).toBe(renewedToken);
    expect(localStorage.getItem('refreshToken')).toBe('refresh-token-rotado');
    vi.restoreAllMocks();
  });

  it('limpia la sesión y redirige a /login si el refresh token es inválido al recuperar sesión (INT2-93)', async () => {
    const expiredToken = createTestJwt({
      role: 'CLIENTE',
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    localStorage.setItem('accessToken', expiredToken);
    localStorage.setItem('refreshToken', 'refresh-token-invalido');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: '/problems/refresh-token-invalido',
          title: 'Refresh token inválido',
          status: 401,
          detail: 'El refresh token expiró.',
        }),
        { status: 401, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );

    renderAppAt('/compras');

    expect(await screen.findByRole('heading', { name: 'Iniciar Sesión' })).toBeTruthy();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    vi.restoreAllMocks();
  });
});
describe('navegación y rutas de ADMIN_CAFETERIA y SUPER_ADMIN (INT2-130)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('muestra enlaces separados para ADMIN_CAFETERIA con asignación válida y bloquea rutas de SUPER_ADMIN', async () => {
    const cafeteriaId = '44444444-4444-4444-8444-444444444444';
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'ADMIN_CAFETERIA',
        cafeteriaId,
      }),
    );

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/v1/auth/users/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: '11111111-1111-4111-8111-111111111111',
              email: 'admin.central@cloudcoffee.cl',
              nombre: 'Admin',
              apellido: 'Central',
              telefono: null,
              rol: 'ADMIN_CAFETERIA',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url.endsWith(`/v1/catalog/cafeterias/${cafeteriaId}/ofertas`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: '55555555-5555-4555-8555-555555555501',
                productoId: '33333333-3333-4333-8333-333333333333',
                productoNombre: 'Espresso',
                precio: 1500,
                stock: 20,
                estado: 'AVAILABLE',
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    renderAppAt('/admin');

    expect(screen.getByRole('link', { name: 'Panel Administración' })).toBeTruthy();
    expect(await screen.findByText(/Cafetería asignada: 44444444-4444-4444-8444-444444444444 · 1 ofertas/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mi Cafetería' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Personal (Cajeros)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ofertas y Precios' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Inventario y Stock' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ventas de Cafetería' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Catálogo Maestro' })).toBeNull();

    cleanup();

    // Acceso directo a URL de SUPER_ADMIN queda restringido
    renderAppAt('/superadmin/catalogo');
    expect(screen.getByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir al panel de administración' }).getAttribute('href')).toBe('/admin');
  });

  it('muestra estado sin asignación y ninguna acción operativa cuando ADMIN_CAFETERIA no tiene cafetería asignada', () => {
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'ADMIN_CAFETERIA',
      }),
    );

    renderAppAt('/admin');

    expect(screen.getByRole('heading', { name: 'Personal sin cafetería asignada' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Secciones de administración' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Configurar estado operativo' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Registrar ajuste de stock' })).toBeNull();
  });

  it('muestra enlaces globales para SUPER_ADMIN y restringe rutas operativas de cafetería (/admin/inventario y /cajero)', async () => {
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'SUPER_ADMIN',
      }),
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '99999999-9999-4999-8999-999999999999',
          email: 'superadmin@cloudcoffee.cl',
          nombre: 'Super',
          apellido: 'Admin',
          telefono: null,
          rol: 'SUPER_ADMIN',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderAppAt('/superadmin');

    expect(screen.getByRole('link', { name: 'Panel Superadministrador' })).toBeTruthy();
    expect(await screen.findByText('Alcance: Plataforma global')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Cafeterías y Campus' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Usuarios y Administradores' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Catálogo Maestro' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ventas Globales' })).toBeTruthy();
    // SUPER_ADMIN no tiene enlace de ajuste de stock ni estado operativo
    expect(screen.queryByRole('link', { name: 'Inventario y Stock' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Mi Cafetería' })).toBeNull();

    cleanup();

    renderAppAt('/admin/inventario');
    expect(screen.getByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ir al panel de superadministración' }).getAttribute('href')).toBe('/superadmin');
  });

  it('oculta datos anteriores cuando una asignación es revocada (403) o cambia de cafetería', async () => {
    const cafA = '44444444-4444-4444-8444-444444444444';
    const cafB = '55555555-5555-4555-8555-555555555555';

    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'ADMIN_CAFETERIA',
        cafeteriaId: cafA,
      }),
    );

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/v1/auth/users/me')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: '11111111-1111-4111-8111-111111111111',
              email: 'admin.central@cloudcoffee.cl',
              nombre: 'Admin',
              apellido: 'Central',
              telefono: null,
              rol: 'ADMIN_CAFETERIA',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (url.endsWith(`/v1/catalog/cafeterias/${cafA}/ofertas`)) {
        return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.endsWith(`/v1/catalog/cafeterias/${cafB}/ofertas`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              type: '/problems/asignacion-no-autorizada',
              title: 'Forbidden',
              status: 403,
              detail: 'Tu asignación a esta cafetería fue revocada.',
              code: 'ASIGNACION_NO_AUTORIZADA',
            }),
            { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
          ),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });

    renderAppAt('/admin');
    expect(await screen.findByText(/Cafetería asignada: 44444444-4444-4444-8444-444444444444/)).toBeTruthy();

    // Simular cambio de token a una cafetería revocada (403)
    await act(async () => {
      localStorage.setItem(
        'accessToken',
        createTestJwt({
          role: 'ADMIN_CAFETERIA',
          cafeteriaId: cafB,
        }),
      );
      window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Asignación o permiso no autorizado' })).toBeTruthy();
    });
    expect(screen.getByText('Tu asignación a esta cafetería fue revocada.')).toBeTruthy();
    expect(screen.queryByText(/Cafetería asignada: 44444444-4444-4444-8444-444444444444/)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Secciones de administración' })).toBeNull();
  });
});