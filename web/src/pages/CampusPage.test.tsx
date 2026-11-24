// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router';
import { Navbar } from '../components/layout/Navbar';
import { CampusPage, CatalogEntry } from './CampusPage';
import { getCampus } from '../services/catalog';
import { selectCampus, selectedCampusId } from '../services/selectedCampus';
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ isLoggedIn: true, role: 'CLIENTE' }) }));
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

function CatalogDestination() {
  const [params] = useSearchParams();
  return <h1>Catálogo {params.get('campusId') ?? selectedCampusId()}</h1>;
}

it('abre el cambio desde la barra y conserva el campus original hasta confirmar', async () => {
  selectCampus({ id: 'campus-1', nombre: 'San Francisco' });
  render(
    <MemoryRouter>
      <Navbar />
      <Routes>
        <Route path="/" element={<h1>Inicio</h1>} />
        <Route path="/campus/cambiar" element={<CampusPage mode="change" />} />
        <Route path="/catalogo" element={<CatalogDestination />} />
      </Routes>
    </MemoryRouter>,
  );

  const changeCampus = screen.getByRole('link', { name: 'Cambiar campus' });
  expect(changeCampus.getAttribute('href')).toBe('/campus/cambiar');
  fireEvent.click(changeCampus);
  expect(await screen.findByRole('radio', { name: 'San Francisco' })).toHaveProperty('checked', true);
  expect(screen.getByText('Campus actual')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Confirmar cambio/ })).toHaveProperty('disabled', true);

  fireEvent.click(screen.getByRole('radio', { name: 'San Juan Pablo II' }));
  expect(selectedCampusId()).toBe('campus-1');
  fireEvent.click(screen.getByRole('link', { name: /Volver al catálogo/ }));
  expect(screen.getByRole('heading', { name: 'Catálogo campus-1' })).toBeTruthy();

  fireEvent.click(screen.getByRole('link', { name: 'Cambiar campus' }));
  fireEvent.click(await screen.findByRole('radio', { name: 'San Juan Pablo II' }));
  fireEvent.click(screen.getByRole('button', { name: /Confirmar cambio/ }));
  expect(screen.getByRole('heading', { name: 'Catálogo campus-2' })).toBeTruthy();
  expect(selectedCampusId()).toBe('campus-2');
});
