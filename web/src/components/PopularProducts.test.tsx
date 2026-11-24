// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { PopularProducts } from './PopularProducts';
import { getPopularProducts } from '../services/popularProducts';
vi.mock('../services/popularProducts', () => ({ getPopularProducts:vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });
afterEach(cleanup);
it('ofrece tarjetas con imagen clicable y controles de desplazamiento', async () => {
  vi.mocked(getPopularProducts).mockResolvedValue([{id:'cafe',nombre:'Café',imagenUrl:'/cafe.png',descripcion:'Recién preparado',categoria:{id:'b',nombre:'Bebidas'}}]);
  render(<MemoryRouter><PopularProducts /></MemoryRouter>);
  const image = await screen.findByRole('img', {name:'Café'});
  expect(image.closest('a')?.getAttribute('href')).toBe('/catalogo/productos/cafe');
  expect(screen.getByRole('button', {name:'Productos siguientes'})).toBeTruthy();
  expect(screen.getByRole('button', {name:'Productos anteriores'})).toBeTruthy();
});
it('permite reintentar y muestra vacío cuando no hay órdenes pagadas', async () => {
  vi.mocked(getPopularProducts).mockRejectedValueOnce(new Error()).mockResolvedValueOnce([]);
  render(<MemoryRouter><PopularProducts /></MemoryRouter>); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', {name:'Reintentar'}));
  expect(await screen.findByRole('link', {name:'Explorar el catálogo →'})).toBeTruthy();
});
