// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../contexts/AuthContext';
import type { CafeteriaAdminItem } from '../services/cafeteriaAdmin';
import { ApiRequestError, request } from '../services/httpClient';
import { UserRole } from '../utils/jwt';

vi.mock('../config/env', () => ({
  env: {
    appTitle: 'CloudCoffee Test',
    apiBaseUrl: 'http://localhost:18080',
  },
}));

vi.mock('../services/httpClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/httpClient')>()),
  request: vi.fn(),
}));

const campusA = '11111111-1111-4111-8111-111111111111';
const campusB = '11111111-1111-4111-8111-222222222222';
const cafCentral = '44444444-4444-4444-8444-444444444444';
const cafNorte = '55555555-5555-4555-8555-555555555555';
const productId = '33333333-3333-4333-8333-333333333333';

function createTestJwt(payload: { sub?: string; role: UserRole; cafeteriaId?: string }): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(
    JSON.stringify({
      sub: payload.sub ?? '99999999-9999-4999-8999-999999999999',
      role: payload.role,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...(payload.cafeteriaId ? { cafeteriaId: payload.cafeteriaId } : {}),
    }),
  );
  return `${header}.${body}.signature`;
}

function renderAt(path: string) {
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
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('gestión de cafeterías y parámetros operativos desde web (INT2-131)', () => {
  it('SUPER_ADMIN lista, filtra por campus, valida formulario, crea, edita y da de baja con confirmación', async () => {
    localStorage.setItem('accessToken', createTestJwt({ role: 'SUPER_ADMIN' }));

    let cafeteriasDb: CafeteriaAdminItem[] = [
      {
        cafeteriaId: cafCentral,
        campusId: campusA,
        nombre: 'Cafetería Central',
        estadoOperativo: 'OPEN',
        activa: true,
        bajaAt: null,
        version: 1,
      },
    ];

    vi.mocked(request).mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      if (path === '/v1/auth/users/me') {
        return Promise.resolve({
          id: '99999999-9999-4999-8999-999999999999',
          email: 'superadmin@cloudcoffee.cl',
          nombre: 'Super',
          apellido: 'Admin',
          telefono: null,
          rol: 'SUPER_ADMIN',
        });
      }
      if (path.startsWith('/v1/catalog/admin/campus?')) {
        return Promise.resolve({
          content: [
            {
              campusId: campusA,
              nombre: 'Campus San Francisco',
              direccion: 'Av. Alemania',
              activo: true,
              bajaAt: null,
              version: 1,
            },
            {
              campusId: campusB,
              nombre: 'Campus Norte',
              direccion: 'Av. Norte',
              activo: true,
              bajaAt: null,
              version: 1,
            },
          ],
          number: 0,
          size: 100,
          totalElements: 2,
          totalPages: 1,
          first: true,
          last: true,
        });
      }
      if (path.startsWith('/v1/catalog/admin/cafeterias?') && method === 'GET') {
        const query = new URLSearchParams(path.split('?')[1] ?? '');
        const filterCampus = query.get('campusId');
        const filtered = filterCampus
          ? cafeteriasDb.filter((c) => c.campusId === filterCampus)
          : cafeteriasDb;
        return Promise.resolve({
          content: filtered,
          number: 0,
          size: 20,
          totalElements: filtered.length,
          totalPages: 1,
          first: true,
          last: true,
        });
      }
      if (path === '/v1/catalog/admin/cafeterias' && method === 'POST') {
        const body = JSON.parse(String(options?.body)) as { campusId: string; nombre: string };
        const created = {
          cafeteriaId: cafNorte,
          campusId: body.campusId,
          nombre: body.nombre,
          estadoOperativo: 'CLOSED' as const,
          activa: true,
          bajaAt: null,
          version: 1,
        };
        cafeteriasDb = [...cafeteriasDb, created];
        return Promise.resolve(created);
      }
      if (path === `/v1/catalog/admin/cafeterias/${cafCentral}` && method === 'PATCH') {
        const body = JSON.parse(String(options?.body)) as { nombre: string; version: number };
        const updated = { ...cafeteriasDb[0], nombre: body.nombre, version: body.version + 1 };
        cafeteriasDb = [updated, ...cafeteriasDb.slice(1)];
        return Promise.resolve(updated);
      }
      if (path === `/v1/catalog/admin/cafeterias/${cafCentral}/baja` && method === 'POST') {
        const deactivated = {
          ...cafeteriasDb[0],
          activa: false,
          bajaAt: '2026-11-23T20:00:00Z',
          version: cafeteriasDb[0].version + 1,
        };
        cafeteriasDb = [deactivated, ...cafeteriasDb.slice(1)];
        return Promise.resolve(deactivated);
      }
      return Promise.reject(new Error(`Ruta no esperada: ${method} ${path}`));
    });

    renderAt('/superadmin/cafeterias');

    expect(await screen.findByRole('heading', { name: 'Cafetería Central' })).toBeTruthy();
    // SUPER_ADMIN no tiene botón para cambiar el estado operativo
    expect(screen.queryByRole('button', { name: 'Actualizar estado operativo' })).toBeNull();

    // Validación de nombre vacío
    fireEvent.click(screen.getByRole('button', { name: 'Crear cafetería' }));
    expect(await screen.findByText('El nombre de la cafetería es obligatorio.')).toBeTruthy();

    // Crear nueva cafetería con selección de campus
    fireEvent.change(screen.getByLabelText('Campus de la cafetería'), {
      target: { value: campusB },
    });
    fireEvent.change(screen.getByLabelText('Nombre de la cafetería'), {
      target: { value: '  Kiosco Biblioteca  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cafetería' }));

    expect(await screen.findByRole('heading', { name: 'Kiosco Biblioteca' })).toBeTruthy();

    // Filtrar por Campus Norte
    fireEvent.change(screen.getByLabelText('Filtrar por campus'), {
      target: { value: campusB },
    });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Cafetería Central' })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Kiosco Biblioteca' })).toBeTruthy();
    });

    // Volver a todos los campus, editar Cafetería Central y confirmar baja lógica
    fireEvent.change(screen.getByLabelText('Filtrar por campus'), {
      target: { value: '' },
    });
    expect(await screen.findByRole('heading', { name: 'Cafetería Central' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar nombre' })[0]);
    fireEvent.change(screen.getByLabelText('Nuevo nombre para la cafetería'), {
      target: { value: 'Cafetería Central Renovada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('heading', { name: 'Cafetería Central Renovada' })).toBeTruthy();

    // Confirmar baja lógica
    fireEvent.click(screen.getAllByRole('button', { name: 'Dar de baja' })[0]);
    expect(
      screen.getByRole('heading', {
        name: 'Confirmar baja lógica de Cafetería Central Renovada',
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de cafetería' }));

    expect(
      await screen.findByText(
        /La cafetería "Cafetería Central Renovada" fue dada de baja lógica/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeTruthy();
  });

  it('ADMIN_CAFETERIA consulta y cambia solo el estado operativo de su cafetería, maneja conflictos y refleja efecto en catálogo', async () => {
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'ADMIN_CAFETERIA',
        cafeteriaId: cafCentral,
      }),
    );

    let operationalStatus: 'OPEN' | 'CLOSED' | 'MAINTENANCE' = 'OPEN';
    let version = 2;

    vi.mocked(request).mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      if (path === '/v1/auth/users/me') {
        return Promise.resolve({
          id: '22222222-2222-4222-8222-222222222222',
          email: 'admin.central@cloudcoffee.cl',
          nombre: 'Admin',
          apellido: 'Central',
          telefono: null,
          rol: 'ADMIN_CAFETERIA',
        });
      }
      if (path === `/v1/catalog/cafeterias/${cafCentral}/ofertas`) {
        return Promise.resolve([]);
      }
      if (path === `/v1/catalog/cafeterias/${cafCentral}` && method === 'GET') {
        return Promise.resolve({
          cafeteriaId: cafCentral,
          campusId: campusA,
          nombre: 'Cafetería Central',
          estadoOperativo: operationalStatus,
          activa: true,
          bajaAt: null,
          version,
        });
      }
      if (
        path === `/v1/catalog/cafeterias/${cafCentral}/estado-operativo` &&
        method === 'POST'
      ) {
        const body = JSON.parse(String(options?.body)) as {
          estadoOperativo: 'OPEN' | 'CLOSED' | 'MAINTENANCE';
          version: number;
        };
        if (body.version !== version) {
          return Promise.reject(
            new ApiRequestError(
              409,
              'Conflicto',
              'La versión del recurso no coincide.',
              '/problems/version_conflicto',
              null,
              [],
              'VERSION_CONFLICTO',
            ),
          );
        }
        operationalStatus = body.estadoOperativo;
        version += 1;
        return Promise.resolve({
          cafeteriaId: cafCentral,
          campusId: campusA,
          nombre: 'Cafetería Central',
          estadoOperativo: operationalStatus,
          activa: true,
          bajaAt: null,
          version,
        });
      }
      if (path === `/v1/catalog/productos/${productId}`) {
        return Promise.resolve({
          id: productId,
          nombre: 'Café Americano',
          descripcion: 'Tostado medio',
          imagenUrl: null,
          categoria: { id: 'cat-1', nombre: 'Café' },
        });
      }
      if (path === '/v1/catalog/campus') {
        return Promise.resolve([{ id: campusA, nombre: 'Campus San Francisco' }]);
      }
      if (path.startsWith(`/v1/catalog/productos/${productId}/ofertas?`)) {
        // Cuando la cafetería está CLOSED o dada de baja, el catálogo público no expone su oferta
        return Promise.resolve(
          operationalStatus === 'OPEN'
            ? [
                {
                  id: 'of-1',
                  cafeteriaId: cafCentral,
                  cafeteriaName: 'Cafetería Central',
                  price: 1800,
                  stock: 10,
                  disponible: true,
                },
              ]
            : [],
        );
      }
      return Promise.reject(new Error(`Ruta no esperada: ${method} ${path}`));
    });

    renderAt('/admin/cafeteria');

    expect(
      await screen.findByRole('heading', { name: 'Parámetros operativos de Cafetería Central' }),
    ).toBeTruthy();
    // ADMIN_CAFETERIA no tiene acciones de baja lógica ni de creación de cafetería
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crear cafetería' })).toBeNull();

    // Cambiar estado operativo a CLOSED (Cerrada)
    fireEvent.change(screen.getByLabelText('Estado operativo de la cafetería'), {
      target: { value: 'CLOSED' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar estado operativo' }));

    expect(
      await screen.findByText('Estado operativo actualizado a "Cerrada" (versión 3).'),
    ).toBeTruthy();

    cleanup();

    // Verificar efecto del cierre operativo en el recorrido del catálogo público
    renderAt(`/catalogo/productos/${productId}?campusId=${campusA}`);
    expect(
      await screen.findByText(
        'No hay ofertas disponibles para este producto en el campus seleccionado.',
      ),
    ).toBeTruthy();
  });
});