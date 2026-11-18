// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import { CampusPage, CatalogEntry } from './CampusPage';
import { getCampus } from '../services/catalog';
import { selectedCampusId } from '../services/selectedCampus';
vi.mock('../services/catalog', async original => ({ ...await original<typeof import('../services/catalog')>(), getCampus: vi.fn() }));
beforeEach(() => { localStorage.clear(); vi.mocked(getCampus).mockResolvedValue([{ id:'campus-1', nombre:'San Francisco' }, { id:'campus-2', nombre:'San Juan Pablo II' }]); });
afterEach(cleanup);
function view(path = '/campus') { render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/campus" element={<CampusPage />} /><Route path="/catalogo" element={<CatalogEntry />} /></Routes></MemoryRouter>); }
it('interpone campus al entrar al catálogo sin selección previa', async () => {
  view('/catalogo'); expect(await screen.findByRole('heading', { name:'¿En qué campus estás?' })).toBeTruthy();
  expect(screen.getByRole('button', { name:/Continuar al catálogo/ })).toHaveProperty('disabled', true);
});
it('guarda solo el campus confirmado y permite cambiar una selección previa', async () => {
  view(); fireEvent.click(await screen.findByRole('radio', { name:/San Francisco/ }));
  expect(selectedCampusId()).toBe('');
  expect(screen.getByRole('button', { name:/Continuar al catálogo/ })).toHaveProperty('disabled', false);
  fireEvent.click(screen.getByRole('button', { name:/Continuar al catálogo/ }));
  expect(selectedCampusId()).toBe('campus-1');
});
it('permite reintentar y presenta vacío sin opciones inventadas', async () => {
  vi.mocked(getCampus).mockRejectedValueOnce(new Error()).mockResolvedValueOnce([]); view();
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name:'Reintentar' }));
  expect(await screen.findByText('No hay campus disponibles.')).toBeTruthy();
});
