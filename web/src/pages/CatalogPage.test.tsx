// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogPage } from './CatalogPage';
import { ApiRequestError, request } from '../services/httpClient';
import type { ProductPage } from '../services/catalog';

vi.mock('../services/httpClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/httpClient')>(),
  request: vi.fn(),
}));

const campusA = '11111111-1111-4111-8111-111111111111';
const campusB = '11111111-1111-4111-8111-222222222222';
const categoryId = '22222222-2222-4222-8222-222222222222';
const campus = [{ id: campusA, nombre: 'San Francisco' }, { id: campusB, nombre: 'San Juan Pablo II' }];
const categories = [{ id: categoryId, nombre: 'Bebidas' }];

function page(number = 0, totalElements = 13, nombre = `Producto página ${number + 1}`): ProductPage {
  const totalPages = Math.ceil(totalElements / 12);
  return {
    content: totalElements === 0 ? [] : [{
      id: '33333333-3333-4333-8333-333333333333', categoriaId: categoryId,
      nombre, descripcion: 'Recién preparado', imagenUrl: null, estado: 'ACTIVE',
    }],
    number, size: 12, totalElements, totalPages, first: number === 0, last: number >= totalPages - 1,
  };
}

function productRequests() {
  return vi.mocked(request).mock.calls
    .filter(([path]) => path.startsWith('/v1/catalog/productos?'))
    .map(([path, options]) => ({
      params: new URL(path, 'http://gateway.test').searchParams,
      signal: options?.signal,
      omitAccessToken: options?.omitAccessToken,
    }));
}

function lastRequest() {
  return productRequests().at(-1)!;
}

async function selectCampus() {
  render(<CatalogPage />);
  await screen.findByRole('option', { name: 'San Francisco' });
  fireEvent.change(screen.getByLabelText('Campus'), { target: { value: campusA } });
  await screen.findByRole('heading', { name: 'Producto página 1' });
}

async function nextPage() {
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('heading', { name: 'Producto página 2' });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === '/v1/catalog/campus') return campus;
    if (path === '/v1/catalog/categorias') return categories;
    if (path.startsWith('/v1/catalog/productos?')) {
      return page(Number(new URL(path, 'http://gateway.test').searchParams.get('page')));
    }
    throw new Error(`Ruta inesperada: ${path}`);
  });
});

afterEach(cleanup);

describe('catálogo web', () => {
  it('espera un campus antes de consultar productos y deshabilita los filtros dependientes', async () => {
    render(<CatalogPage />);
    await screen.findByRole('option', { name: 'San Francisco' });
    expect(productRequests()).toHaveLength(0);
    expect(vi.mocked(request).mock.calls.every(([, options]) => options?.omitAccessToken === true)).toBe(true);
    expect((screen.getByLabelText('Categoría') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('searchbox') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Selecciona un campus para ver sus productos.')).toBeTruthy();
  });

  it('pagina según los metadatos del servidor y respeta ambos límites', async () => {
    await selectCampus();
    expect(lastRequest().omitAccessToken).toBe(true);
    expect(screen.getByText('13 productos · Página 1 de 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(true);
    expect(lastRequest().params.get('size')).toBe('12');
    expect(lastRequest().params.getAll('sort')).toEqual(['name,asc', 'id,asc']);
    await nextPage();
    expect(lastRequest().params.get('page')).toBe('1');
    expect((screen.getByRole('button', { name: 'Siguiente' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByRole('heading', { name: 'Producto página 1' });
    expect(lastRequest().params.get('page')).toBe('0');
  });

  it('busca al enviar, recorta y codifica el texto, y conserva filtros al paginar', async () => {
    await selectCampus();
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: categoryId } });
    await waitFor(() => expect(lastRequest().params.get('categoriaId')).toBe(categoryId));
    await screen.findByRole('heading', { name: 'Producto página 1' });
    await nextPage();
    const count = productRequests().length;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  café & té + leche  ' } });
    expect(productRequests()).toHaveLength(count);
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByRole('heading', { name: 'Producto página 1' });
    expect(Object.fromEntries(lastRequest().params)).toMatchObject({
      campusId: campusA, categoriaId: categoryId, q: 'café & té + leche', page: '0',
    });
    await nextPage();
    expect(lastRequest().params.get('q')).toBe('café & té + leche');
    expect(lastRequest().params.get('categoriaId')).toBe(categoryId);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByRole('heading', { name: 'Producto página 1' });
    expect(lastRequest().params.has('q')).toBe(false);
  });

  it('cambiar categoría vuelve a la primera página conservando la búsqueda', async () => {
    await selectCampus();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'café' } });
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByRole('heading', { name: 'Producto página 1' });
    await nextPage();
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: categoryId } });
    await screen.findByRole('heading', { name: 'Producto página 1' });
    expect(Object.fromEntries(lastRequest().params)).toMatchObject({ categoriaId: categoryId, q: 'café', page: '0' });
  });

  it('cambiar campus limpia categoría, búsqueda y página en una sola consulta', async () => {
    await selectCampus();
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: categoryId } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'café' } });
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByRole('heading', { name: 'Producto página 1' });
    await nextPage();
    const count = productRequests().length;
    fireEvent.change(screen.getByLabelText('Campus'), { target: { value: campusB } });
    expect(screen.queryByRole('heading', { name: 'Producto página 2' })).toBeNull();
    await screen.findByRole('heading', { name: 'Producto página 1' });
    expect(productRequests()).toHaveLength(count + 1);
    expect(lastRequest().params.get('campusId')).toBe(campusB);
    expect(lastRequest().params.get('page')).toBe('0');
    expect(lastRequest().params.has('q')).toBe(false);
    expect(lastRequest().params.has('categoriaId')).toBe(false);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Categoría') as HTMLSelectElement).value).toBe('');
  });

  it('cancela consultas anteriores e ignora su respuesta aunque el transporte no respete la cancelación', async () => {
    await selectCampus();
    let resolveOld!: (value: ProductPage) => void;
    const oldResponse = new Promise<ProductPage>((resolve) => { resolveOld = resolve; });
    vi.mocked(request).mockReturnValueOnce(oldResponse);
    fireEvent.submit(screen.getByRole('search'));
    const oldRequest = lastRequest();
    fireEvent.change(screen.getByLabelText('Campus'), { target: { value: campusB } });
    await screen.findByRole('heading', { name: 'Producto página 1' });
    expect(oldRequest.signal?.aborted).toBe(true);
    await act(async () => { resolveOld(page(0, 1, 'Respuesta obsoleta')); });
    expect(screen.queryByText('Respuesta obsoleta')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Producto página 1' })).toBeTruthy();
  });

  it('muestra una búsqueda vacía sin controles de paginación', async () => {
    await selectCampus();
    vi.mocked(request).mockResolvedValueOnce(page(0, 0));
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByText('No se encontraron productos con estos filtros.');
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('recupera la última página válida si disminuye el total de productos', async () => {
    await selectCampus();
    vi.mocked(request).mockResolvedValueOnce({ ...page(1, 1), content: [] });
    vi.mocked(request).mockResolvedValueOnce(page(0, 1));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('1 producto · Página 1 de 1');
    expect(productRequests().slice(-2).map(({ params }) => params.get('page'))).toEqual(['1', '0']);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('permite reintentar un error de productos conservando los filtros', async () => {
    await selectCampus();
    vi.mocked(request).mockRejectedValueOnce(new ApiRequestError(503, 'No disponible', 'Intenta más tarde.'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'café' } });
    fireEvent.submit(screen.getByRole('search'));
    await screen.findByText('Intenta más tarde.');
    expect(screen.queryByRole('heading', { name: 'Producto página 1' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('heading', { name: 'Producto página 1' });
    expect(lastRequest().params.get('q')).toBe('café');
  });

  it('permite reintentar la carga inicial', async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error('Fallo de red'));
    render(<CatalogPage />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('option', { name: 'San Francisco' });
    expect(productRequests()).toHaveLength(0);
  });

  it('informa cuando no hay campus disponibles', async () => {
    vi.mocked(request).mockResolvedValueOnce([]);
    render(<CatalogPage />);
    await screen.findByText('No hay campus disponibles.');
    expect(productRequests()).toHaveLength(0);
  });
});
