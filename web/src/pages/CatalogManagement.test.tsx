// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../contexts/AuthContext';
import type { CategoryAdminItem, ProductAdminItem } from '../services/catalogAdmin';
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

const catBebidas = '11111111-1111-4111-8111-111111111111';
const catPasteleria = '11111111-1111-4111-8111-222222222222';
const catInactiva = '11111111-1111-4111-8111-333333333333';
const prodEspresso = '22222222-2222-4222-8222-111111111111';
const prodMuffin = '22222222-2222-4222-8222-222222222222';
const prodNuevo = '22222222-2222-4222-8222-333333333333';

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

function superAdminProfile() {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    email: 'superadmin@cloudcoffee.cl',
    nombre: 'Super',
    apellido: 'Admin',
    telefono: null,
    rol: 'SUPER_ADMIN',
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('administración del catálogo maestro desde el panel web (INT2-133)', () => {
  it('restringe el acceso a /superadmin/catalogo para roles distintos a SUPER_ADMIN', () => {
    localStorage.setItem(
      'accessToken',
      createTestJwt({
        role: 'ADMIN_CAFETERIA',
        cafeteriaId: '44444444-4444-4444-8444-444444444444',
      }),
    );

    renderAt('/superadmin/catalogo');

    expect(screen.getByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Crear nuevo producto' })).toBeNull();
  });

  it('muestra estado de carga, error de carga y permite reintentar exitosamente', async () => {
    localStorage.setItem('accessToken', createTestJwt({ role: 'SUPER_ADMIN' }));

    let productAttempts = 0;
    vi.mocked(request).mockImplementation((path: string) => {
      if (path === '/v1/auth/users/me') {
        return Promise.resolve(superAdminProfile());
      }
      if (path.startsWith('/v1/catalog/admin/categorias?')) {
        return Promise.resolve({
          content: [
            {
              categoriaId: catBebidas,
              nombre: 'Bebidas Calientes',
              descripcion: 'Cafés y tés',
              activa: true,
              version: 1,
            },
          ],
          number: 0,
          size: 100,
          totalElements: 1,
          totalPages: 1,
          first: true,
          last: true,
        });
      }
      if (path.startsWith('/v1/catalog/admin/productos?')) {
        productAttempts += 1;
        if (productAttempts === 1) {
          return Promise.reject(
            new ApiRequestError(503, 'Servicio no disponible', 'El servicio de catálogo no respondió.'),
          );
        }
        return Promise.resolve({
          content: [],
          number: 0,
          size: 20,
          totalElements: 0,
          totalPages: 0,
          first: true,
          last: true,
        });
      }
      return Promise.reject(new Error(`Ruta no esperada: ${path}`));
    });

    renderAt('/superadmin/catalogo');

    expect(await screen.findByText('El servicio de catálogo no respondió.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar carga' }));

    expect(
      await screen.findByText('Aún no hay productos registrados en el catálogo maestro.'),
    ).toBeTruthy();
    expect(productAttempts).toBe(2);
  });

  it('lista, busca, pagina, valida por campo, crea, edita, da de baja y reactiva productos', async () => {
    localStorage.setItem('accessToken', createTestJwt({ role: 'SUPER_ADMIN' }));

    const categoriesDb: CategoryAdminItem[] = [
      {
        categoriaId: catBebidas,
        nombre: 'Bebidas Calientes',
        descripcion: 'Cafés de especialidad',
        activa: true,
        version: 1,
      },
      {
        categoriaId: catPasteleria,
        nombre: 'Pastelería',
        descripcion: 'Repostería del día',
        activa: true,
        version: 1,
      },
      {
        categoriaId: catInactiva,
        nombre: 'Temporada Anterior',
        descripcion: 'Retirada',
        activa: false,
        version: 2,
      },
    ];

    let productsDb: ProductAdminItem[] = [
      {
        productoId: prodEspresso,
        categoriaId: catBebidas,
        nombre: 'Espresso Doble',
        descripcion: 'Doble carga de grano arábica',
        imagenUrl: 'https://cdn.cloudcoffee.cl/espresso.jpg',
        activo: true,
        version: 1,
      },
      {
        productoId: prodMuffin,
        categoriaId: catPasteleria,
        nombre: 'Muffin Arándano',
        descripcion: 'Horneado sin azúcar',
        imagenUrl: null,
        activo: false,
        version: 2,
      },
    ];

    const seenQueries: string[] = [];

    vi.mocked(request).mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      if (path === '/v1/auth/users/me') {
        return Promise.resolve(superAdminProfile());
      }
      if (path.startsWith('/v1/catalog/admin/categorias?') && method === 'GET') {
        return Promise.resolve({
          content: categoriesDb,
          number: 0,
          size: 100,
          totalElements: categoriesDb.length,
          totalPages: 1,
          first: true,
          last: true,
        });
      }
      if (path.startsWith('/v1/catalog/admin/productos?') && method === 'GET') {
        seenQueries.push(path);
        const params = new URLSearchParams(path.split('?')[1] ?? '');
        const q = params.get('q')?.toLowerCase() ?? '';
        const pageNum = Number(params.get('page') ?? '0');
        const filtered = productsDb.filter((p) => {
          if (q && !p.nombre.toLowerCase().includes(q)) return false;
          return true;
        });
        return Promise.resolve({
          content: filtered,
          number: pageNum,
          size: 20,
          totalElements: filtered.length,
          totalPages: q ? 1 : 2,
          first: pageNum === 0,
          last: pageNum >= (q ? 0 : 1),
        });
      }
      if (path === '/v1/catalog/admin/productos' && method === 'POST') {
        const headers = options?.headers as Record<string, string>;
        expect(headers['Idempotency-Key']).toBeTruthy();
        const body = JSON.parse(String(options?.body ?? '{}')) as {
          categoriaId: string;
          nombre: string;
          descripcion?: string;
          imagenUrl?: string;
        };
        const created: ProductAdminItem = {
          productoId: prodNuevo,
          categoriaId: body.categoriaId,
          nombre: body.nombre,
          descripcion: body.descripcion ?? null,
          imagenUrl: body.imagenUrl ?? null,
          activo: true,
          version: 1,
        };
        productsDb = [created, ...productsDb];
        return Promise.resolve(created);
      }
      if (path === `/v1/catalog/admin/productos/${prodNuevo}` && method === 'PATCH') {
        const body = JSON.parse(String(options?.body ?? '{}')) as {
          nombre: string;
          version: number;
        };
        productsDb = productsDb.map((p) =>
          p.productoId === prodNuevo ? { ...p, nombre: body.nombre, version: body.version + 1 } : p,
        );
        return Promise.resolve(productsDb.find((p) => p.productoId === prodNuevo));
      }
      if (path === `/v1/catalog/admin/productos/${prodNuevo}/baja` && method === 'POST') {
        productsDb = productsDb.map((p) =>
          p.productoId === prodNuevo ? { ...p, activo: false, version: p.version + 1 } : p,
        );
        return Promise.resolve(productsDb.find((p) => p.productoId === prodNuevo));
      }
      if (path === `/v1/catalog/admin/productos/${prodNuevo}/reactivar` && method === 'POST') {
        productsDb = productsDb.map((p) =>
          p.productoId === prodNuevo ? { ...p, activo: true, version: p.version + 1 } : p,
        );
        return Promise.resolve(productsDb.find((p) => p.productoId === prodNuevo));
      }
      return Promise.reject(new Error(`Ruta no esperada: ${method} ${path}`));
    });

    renderAt('/superadmin/catalogo');

    // Muestra activos e inactivos con el efecto sobre la venta pública
    expect(await screen.findByText('Espresso Doble')).toBeTruthy();
    expect(screen.getByText('Muffin Arándano')).toBeTruthy();
    expect(
      screen.getByText(
        'Oculto en la venta pública; conserva ofertas previas e historial de compras.',
      ),
    ).toBeTruthy();

    // Validación de búsqueda < 2 caracteres
    fireEvent.change(screen.getByLabelText('Buscar producto'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText('Ingresa al menos 2 caracteres para buscar productos.')).toBeTruthy();

    // Paginación hacia página siguiente
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => {
      expect(seenQueries.some((q) => q.includes('page=1'))).toBe(true);
    });

    // Validación por campo en creación: nombre vacío e imagen no HTTPS
    fireEvent.change(screen.getByLabelText('URL de imagen (HTTPS, opcional)'), {
      target: { value: 'http://inseguro.cl/foto.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(screen.getByText('El nombre del producto es obligatorio.')).toBeTruthy();
    expect(
      screen.getByText('La imagen debe ser una URL HTTPS válida de hasta 255 caracteres.'),
    ).toBeTruthy();

    // Crear producto válido
    fireEvent.change(screen.getByLabelText('Nombre del producto'), {
      target: { value: 'Latte Caramelo' },
    });
    fireEvent.change(screen.getByLabelText('URL de imagen (HTTPS, opcional)'), {
      target: { value: 'https://cdn.cloudcoffee.cl/latte.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }));

    expect(await screen.findByText('Producto "Latte Caramelo" creado correctamente.')).toBeTruthy();

    // Editar producto
    const editButtons = screen.getAllByRole('button', { name: 'Editar' });
    fireEvent.click(editButtons[0]);
    fireEvent.change(screen.getByLabelText('Nombre al editar producto'), {
      target: { value: 'Latte Caramelo Grande' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios del producto' }));
    expect(
      await screen.findByText('Producto "Latte Caramelo Grande" actualizado a la versión 2.'),
    ).toBeTruthy();

    // Dar de baja lógica con confirmación
    const deactivateButtons = screen.getAllByRole('button', { name: 'Dar de baja' });
    fireEvent.click(deactivateButtons[0]);
    expect(screen.getByRole('heading', { name: 'Confirmar baja lógica de producto' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de producto' }));

    expect(
      await screen.findByText(
        'El producto "Latte Caramelo Grande" fue dado de baja lógica. Dejó de estar disponible en la venta pública sin borrar su historial.',
      ),
    ).toBeTruthy();

    // Reactivar producto
    const reactivateButtons = screen.getAllByRole('button', { name: 'Reactivar' });
    fireEvent.click(reactivateButtons[0]);
    expect(
      await screen.findByText('El producto "Latte Caramelo Grande" fue reactivado correctamente.'),
    ).toBeTruthy();
  });

  it('resuelve conflicto de categoría en uso y conflicto de versión con respuesta del servidor', async () => {
    localStorage.setItem('accessToken', createTestJwt({ role: 'SUPER_ADMIN' }));

    const categoriesDb: CategoryAdminItem[] = [
      {
        categoriaId: catBebidas,
        nombre: 'Bebidas Calientes',
        descripcion: 'Cafés y tés',
        activa: true,
        version: 1,
      },
      {
        categoriaId: catInactiva,
        nombre: 'Estacional',
        descripcion: 'Fuera de temporada',
        activa: false,
        version: 2,
      },
    ];

    const productRequests: string[] = [];

    vi.mocked(request).mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      if (path === '/v1/auth/users/me') {
        return Promise.resolve(superAdminProfile());
      }
      if (path.startsWith('/v1/catalog/admin/categorias?') && method === 'GET') {
        return Promise.resolve({
          content: categoriesDb,
          number: 0,
          size: 20,
          totalElements: categoriesDb.length,
          totalPages: 1,
          first: true,
          last: true,
        });
      }
      if (path.startsWith('/v1/catalog/admin/productos?') && method === 'GET') {
        productRequests.push(path);
        return Promise.resolve({
          content: [
            {
              productoId: prodEspresso,
              categoriaId: catBebidas,
              nombre: 'Espresso Doble',
              descripcion: null,
              imagenUrl: null,
              activo: true,
              version: 1,
            },
          ],
          number: 0,
          size: 20,
          totalElements: 1,
          totalPages: 1,
          first: true,
          last: true,
        });
      }
      if (path === `/v1/catalog/admin/categorias/${catBebidas}` && method === 'PATCH') {
        return Promise.reject(
          new ApiRequestError(
            409,
            'Conflicto',
            'La versión del recurso no coincide',
            '/problems/version-conflicto',
            null,
            [],
            'VERSION_CONFLICTO',
          ),
        );
      }
      if (path === `/v1/catalog/admin/categorias/${catBebidas}/baja` && method === 'POST') {
        return Promise.reject(
          new ApiRequestError(
            409,
            'Conflicto',
            'La categoría contiene productos activos',
            '/problems/categoria-en-uso',
            null,
            [],
            'CATEGORIA_EN_USO',
          ),
        );
      }
      return Promise.reject(new Error(`Ruta no esperada: ${method} ${path}`));
    });

    renderAt('/superadmin/catalogo');

    expect(await screen.findByText('Espresso Doble')).toBeTruthy();

    // Cambiar a pestaña Categorías
    fireEvent.click(screen.getByRole('tab', { name: 'Categorías' }));
    expect(await screen.findByText('Bebidas Calientes')).toBeTruthy();
    expect(screen.getByText('Estacional')).toBeTruthy();
    expect(
      screen.getByText(
        'Oculta en la venta pública y bloqueada para nuevos productos; conserva historial.',
      ),
    ).toBeTruthy();

    // Conflicto de versión al editar categoría
    const editButtons = screen.getAllByRole('button', { name: 'Editar' });
    fireEvent.click(editButtons[0]);
    fireEvent.change(screen.getByLabelText('Nombre al editar categoría'), {
      target: { value: 'Bebidas Calientes Premium' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios de categoría' }));

    expect(
      await screen.findByText(
        'Los datos cambiaron en el servidor por otra operación. Se actualizaron los datos; revisa e inténtalo nuevamente.',
      ),
    ).toBeTruthy();
    // Cierra el formulario desactualizado tras el conflicto
    expect(screen.queryByRole('heading', { name: /Editar categoría:/ })).toBeNull();

    // Intentar dar de baja una categoría con productos activos (CATEGORIA_EN_USO)
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    expect(screen.getByRole('heading', { name: 'Confirmar baja lógica de categoría' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja de categoría' }));

    expect(
      await screen.findByText(
        'No se puede dar de baja la categoría porque contiene productos activos. Da de baja o reasigna esos productos primero.',
      ),
    ).toBeTruthy();

    // Botón directo para resolver saltando a los productos activos de esa categoría
    fireEvent.click(
      screen.getByRole('button', { name: 'Ver productos activos de "Bebidas Calientes"' }),
    );

    await waitFor(() => {
      expect(
        productRequests.some(
          (req) => req.includes(`categoriaId=${catBebidas}`) && req.includes('activo=true'),
        ),
      ).toBe(true);
    });
  });

  it('maneja errores por campo del servidor, producto en categoría inactiva, VERSION_CONFLICTO en producto y limpiar filtros', async () => {
    localStorage.setItem('accessToken', createTestJwt({ role: 'SUPER_ADMIN' }));

    const categoriesDb: CategoryAdminItem[] = [
      {
        categoriaId: catBebidas,
        nombre: 'Bebidas Calientes',
        descripcion: 'Cafés y tés',
        activa: true,
        version: 1,
      },
      {
        categoriaId: catInactiva,
        nombre: 'Estacional',
        descripcion: 'Fuera de temporada',
        activa: false,
        version: 2,
      },
    ];

    let productsDb: ProductAdminItem[] = [
      {
        productoId: prodMuffin,
        categoriaId: catInactiva,
        nombre: 'Té Chai Navideño',
        descripcion: 'Edición invierno',
        imagenUrl: null,
        activo: false,
        version: 2,
      },
    ];

    let lastPatchProductBody: Record<string, unknown> | null = null;
    let productPatchCount = 0;

    vi.mocked(request).mockImplementation((path: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      if (path === '/v1/auth/users/me') {
        return Promise.resolve(superAdminProfile());
      }
      if (path.startsWith('/v1/catalog/admin/categorias?') && method === 'GET') {
        return Promise.resolve({
          content: categoriesDb,
          number: 0,
          size: 100,
          totalElements: categoriesDb.length,
          totalPages: 1,
          first: true,
          last: true,
        });
      }
      if (path === '/v1/catalog/admin/categorias' && method === 'POST') {
        const body = JSON.parse(String(options?.body ?? '{}')) as {
          nombre: string;
          descripcion?: string;
        };
        const created: CategoryAdminItem = {
          categoriaId: catPasteleria,
          nombre: body.nombre,
          descripcion: body.descripcion ?? null,
          activa: true,
          version: 1,
        };
        categoriesDb.push(created);
        return Promise.resolve(created);
      }
      if (path.startsWith('/v1/catalog/admin/productos?') && method === 'GET') {
        const params = new URLSearchParams(path.split('?')[1] ?? '');
        const q = params.get('q')?.toLowerCase() ?? '';
        const filtered = productsDb.filter((p) =>
          q ? p.nombre.toLowerCase().includes(q) : true,
        );
        return Promise.resolve({
          content: filtered,
          number: 0,
          size: 20,
          totalElements: filtered.length,
          totalPages: filtered.length > 0 ? 1 : 0,
          first: true,
          last: true,
        });
      }
      if (path === '/v1/catalog/admin/productos' && method === 'POST') {
        return Promise.reject(
          new ApiRequestError(
            409,
            'Conflicto',
            'Nombre duplicado',
            '/problems/nombre-duplicado',
            null,
            [],
            'NOMBRE_DUPLICADO',
          ),
        );
      }
      if (path === `/v1/catalog/admin/productos/${prodMuffin}` && method === 'PATCH') {
        productPatchCount += 1;
        lastPatchProductBody = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
        if (productPatchCount === 1) {
          productsDb = productsDb.map((p) =>
            p.productoId === prodMuffin
              ? { ...p, nombre: String(lastPatchProductBody?.nombre ?? p.nombre), version: 3 }
              : p,
          );
          return Promise.resolve(productsDb[0]);
        }
        return Promise.reject(
          new ApiRequestError(
            409,
            'Conflicto',
            'La versión del recurso no coincide',
            '/problems/version-conflicto',
            null,
            [],
            'VERSION_CONFLICTO',
          ),
        );
      }
      if (path === `/v1/catalog/admin/productos/${prodMuffin}/reactivar` && method === 'POST') {
        return Promise.reject(
          new ApiRequestError(
            409,
            'Conflicto',
            'No se puede reactivar un producto de una categoría inactiva',
            '/problems/producto-inactivo',
            null,
            [],
            'PRODUCTO_INACTIVO',
          ),
        );
      }
      return Promise.reject(new Error(`Ruta no esperada: ${method} ${path}`));
    });

    renderAt('/superadmin/catalogo');

    expect(await screen.findByText('Té Chai Navideño')).toBeTruthy();

    // Error NOMBRE_DUPLICADO mapeado al campo nombre al crear producto
    fireEvent.change(screen.getByLabelText('Nombre del producto'), {
      target: { value: 'Té Chai Navideño' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(
      await screen.findByText('Ya existe un registro con ese nombre en el catálogo.'),
    ).toBeTruthy();

    // Editar producto con categoría inactiva sin cambiar categoría omite categoriaId en PATCH
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Nombre al editar producto'), {
      target: { value: 'Té Chai Especiado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios del producto' }));
    expect(
      await screen.findByText('Producto "Té Chai Especiado" actualizado a la versión 3.'),
    ).toBeTruthy();
    expect(lastPatchProductBody).toEqual({
      nombre: 'Té Chai Especiado',
      descripcion: 'Edición invierno',
      version: 2,
    });

    // Segundo intento de edición dispara VERSION_CONFLICTO y cierra el formulario
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Nombre al editar producto'), {
      target: { value: 'Té Chai Conflictivo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios del producto' }));
    expect(
      await screen.findByText(
        'Los datos cambiaron en el servidor por otra operación. Se actualizaron los datos; revisa e inténtalo nuevamente.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Editar producto:/ })).toBeNull();

    // Intentar reactivar producto cuya categoría está inactiva (PRODUCTO_INACTIVO)
    fireEvent.click(screen.getByRole('button', { name: 'Reactivar' }));
    expect(
      await screen.findByText('No se puede reactivar un producto de una categoría inactiva'),
    ).toBeTruthy();

    // Estado vacío filtrado y botón Limpiar filtros
    fireEvent.change(screen.getByLabelText('Buscar producto'), {
      target: { value: 'Inexistente' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(
      await screen.findByText('No se encontraron productos para los filtros aplicados.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(await screen.findByText('Té Chai Especiado')).toBeTruthy();

    // Crear nueva categoría en pestaña Categorías
    fireEvent.click(screen.getByRole('tab', { name: 'Categorías' }));
    expect(await screen.findByText('Bebidas Calientes')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nombre de la categoría'), {
      target: { value: 'Bollería' },
    });
    fireEvent.change(screen.getByLabelText('Descripción de la categoría (opcional)'), {
      target: { value: 'Croissants y medialunas' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear categoría' }));
    expect(await screen.findByText('Categoría "Bollería" creada correctamente.')).toBeTruthy();
  });
});
