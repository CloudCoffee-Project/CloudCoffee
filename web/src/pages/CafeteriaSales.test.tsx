// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../contexts/AuthContext';
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

const cafCentral = '44444444-4444-4444-8444-444444444444';
const campusA = '11111111-1111-4111-8111-111111111111';

function createTestJwt(payload: { sub?: string; role: UserRole; cafeteriaId?: string }): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = btoa(
    JSON.stringify({
      sub: payload.sub ?? '22222222-2222-4222-8222-222222222222',
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

describe('panel de ventas e historial de la cafetería en web (INT2-136)', () => {
  it('muestra totales e importes históricos del backend en America/Santiago, permite filtrar y abrir detalle sin consultar otras cafeterías', async () => {
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'ADMIN_CAFETERIA',
        cafeteriaId: cafCentral,
      }),
    );

    const salesItems = [
      {
        ordenId: 'ord-entregada',
        compraId: 'compra-multicafeteria-1',
        codigoOrden: 'ORD-501',
        cafeteriaId: cafCentral,
        cafeteriaNombre: 'Cafetería Central',
        campusId: campusA,
        estado: 'entregado',
        montoTotal: 3600,
        moneda: 'CLP',
        cantidadItems: 1,
        pagadoAt: '2026-11-20T15:30:00Z',
        entregadoAt: '2026-11-20T15:45:00Z',
      },
      {
        ordenId: 'ord-no-retirada',
        compraId: 'compra-2',
        codigoOrden: 'ORD-502',
        cafeteriaId: cafCentral,
        cafeteriaNombre: 'Cafetería Central',
        campusId: campusA,
        estado: 'no_retirado_final',
        montoTotal: 2200,
        moneda: 'CLP',
        cantidadItems: 1,
        pagadoAt: '2026-11-21T14:00:00Z',
        entregadoAt: null,
      },
    ];

    vi.mocked(request).mockImplementation((path: string) => {
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
        // Incluso si el precio actual del catálogo subió a $9.990, la pantalla usa el snapshot del backend
        return Promise.resolve([
          {
            id: 'of-1',
            productoId: 'prod-1',
            productoNombre: 'Café Latte',
            precio: 9990,
            stock: 15,
            estado: 'AVAILABLE',
          },
        ]);
      }
      if (path.startsWith('/v1/orders/ventas/resumen')) {
        const query = new URLSearchParams(path.split('?')[1] ?? '');
        const estado = query.get('estado');
        const filtered = estado ? salesItems.filter((s) => s.estado === estado) : salesItems;
        const montoTotal = filtered.reduce((acc, item) => acc + item.montoTotal, 0);
        return Promise.resolve({
          desde: query.get('desde') ?? '2026-11-01',
          hasta: query.get('hasta') ?? '2026-11-23',
          moneda: 'CLP',
          ordenes: filtered.length,
          montoTotal,
          porEstado: filtered.map((item) => ({
            estado: item.estado,
            ordenes: 1,
            montoTotal: item.montoTotal,
          })),
          porCafeteria: [
            {
              cafeteriaId: cafCentral,
              cafeteriaNombre: 'Cafetería Central',
              ordenes: filtered.length,
              montoTotal,
            },
          ],
        });
      }
      if (path.startsWith('/v1/orders/ventas?')) {
        const query = new URLSearchParams(path.split('?')[1] ?? '');
        // Verificar que jamás se pida una cafetería ajena por query param
        expect(query.has('cafeteriaId')).toBe(false);
        const estado = query.get('estado');
        const filtered = estado ? salesItems.filter((s) => s.estado === estado) : salesItems;
        return Promise.resolve({
          content: filtered,
          number: 0,
          size: 20,
          totalElements: filtered.length,
          totalPages: 1,
          first: true,
          last: true,
          empty: filtered.length === 0,
        });
      }
      if (path === '/v1/orders/ventas/ord-entregada') {
        return Promise.resolve({
          venta: salesItems[0],
          items: [
            {
              ordenItemId: 'item-1',
              ofertaId: 'of-1',
              productoId: 'prod-1',
              productoNombre: 'Café Latte',
              cantidad: 2,
              precioUnitario: 1800,
              subtotal: 3600,
            },
          ],
        });
      }
      return Promise.reject(new Error(`Ruta no esperada: ${path}`));
    });

    renderAt('/admin/ventas?desde=2026-11-01&hasta=2026-11-23');

    expect(await screen.findByText('ORD-501')).toBeTruthy();
    expect(screen.getByText('ORD-502')).toBeTruthy();
    // Totales autorizados del resumen ($3.600 + $2.200 = $5.800), sin recalcular con $9.990
    expect(screen.getByText('$5.800')).toBeTruthy();
    expect(screen.queryByText('$19.980')).toBeNull();

    // Distinción clara entre Entregado y No retirado, y fechas convertidas a America/Santiago (UTC-3 -> 12:30)
    expect(screen.getAllByText('Entregado').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('No retirado (cerrado)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/12:30/)).toBeTruthy();

    // Abrir detalle histórico de ORD-501
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver detalle' })[0]);
    expect(await screen.findByText('Café Latte')).toBeTruthy();
    expect(screen.getByText('$1.800')).toBeTruthy();

    // Filtrar por estado "no_retirado_final" y validar que actualiza listado y resumen
    fireEvent.change(screen.getByLabelText('Estado de la orden'), {
      target: { value: 'no_retirado_final' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    await waitFor(() => {
      expect(screen.queryByText('ORD-501')).toBeNull();
      expect(screen.getByText('ORD-502')).toBeTruthy();
    });
  });

  it('conserva los filtros ante error del servidor, permite reintentar y valida rangos mayores a 92 días', async () => {
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'ADMIN_CAFETERIA',
        cafeteriaId: cafCentral,
      }),
    );

    let failSalesOnce = true;

    vi.mocked(request).mockImplementation((path: string) => {
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
      if (path.startsWith('/v1/orders/ventas')) {
        if (failSalesOnce) {
          failSalesOnce = false;
          return Promise.reject(
            new ApiRequestError(503, 'No disponible', 'Servicio de órdenes temporalmente no disponible.'),
          );
        }
        if (path.startsWith('/v1/orders/ventas/resumen')) {
          return Promise.resolve({
            desde: '2026-11-10',
            hasta: '2026-11-20',
            moneda: 'CLP',
            ordenes: 0,
            montoTotal: 0,
            porEstado: [],
            porCafeteria: [],
          });
        }
        return Promise.resolve({
          content: [],
          number: 0,
          size: 20,
          totalElements: 0,
          totalPages: 0,
          first: true,
          last: true,
          empty: true,
        });
      }
      return Promise.reject(new Error(`Ruta no esperada: ${path}`));
    });

    renderAt('/admin/ventas?desde=2026-11-10&hasta=2026-11-20&estado=entregado');

    expect(
      await screen.findByText('Servicio de órdenes temporalmente no disponible.'),
    ).toBeTruthy();

    // Los filtros se conservan tras el fallo
    expect((screen.getByLabelText('Desde (fecha de pago)') as HTMLInputElement).value).toBe(
      '2026-11-10',
    );
    expect((screen.getByLabelText('Hasta (fecha de pago)') as HTMLInputElement).value).toBe(
      '2026-11-20',
    );
    expect((screen.getByLabelText('Estado de la orden') as HTMLSelectElement).value).toBe(
      'entregado',
    );

    // Reintentar recupera el estado vacío con los mismos filtros
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar consulta' }));
    expect(
      await screen.findByText(
        'No se registraron ventas para tu cafetería en el rango y estado seleccionados.',
      ),
    ).toBeTruthy();

    // Validar rechazo de rango mayor a 92 días
    fireEvent.change(screen.getByLabelText('Desde (fecha de pago)'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta (fecha de pago)'), {
      target: { value: '2026-11-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    expect(
      await screen.findByText(
        'El rango de consulta no puede superar los 92 días inclusivos en America/Santiago.',
      ),
    ).toBeTruthy();
  });

  it.each(['CLIENTE', 'CAJERO', 'SUPER_ADMIN'] as const)(
    'restringe el acceso a /admin/ventas para el rol %s sin consultar endpoints de ventas',
    (unauthorizedRole) => {
      localStorage.setItem(
        'accessToken',
        createTestJwt({
          role: unauthorizedRole,
          ...(unauthorizedRole === 'CAJERO' ? { cafeteriaId: cafCentral } : {}),
        }),
      );

      renderAt('/admin/ventas');

      expect(screen.getByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
      expect(
        vi.mocked(request).mock.calls.some(([path]) => String(path).includes('/v1/orders/ventas')),
      ).toBe(false);
    },
  );
});