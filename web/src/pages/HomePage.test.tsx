// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { HomePage } from './HomePage';
import { CampusPage, CatalogEntry } from './CampusPage';
import { getCampus } from '../services/catalog';
import { selectCampus } from '../services/selectedCampus';

const auth = vi.hoisted(() => ({ isLoggedIn: false, isLoading: false }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../components/PopularProducts', () => ({ PopularProducts: () => null }));
vi.mock('../services/catalog', async original => ({
  ...await original<typeof import('../services/catalog')>(),
  getCampus: vi.fn(),
}));
vi.mock('./CatalogPage', () => ({
  CatalogPage: ({ initialCampusId }: { initialCampusId: string }) => <h1>Catálogo {initialCampusId}</h1>,
}));

const sanFrancisco = {
  id: 'san-francisco',
  nombre: 'Campus San Francisco',
  direccion: 'Manuel Montt 056, Temuco',
  cafeteriasActivas: 2,
};
const sanJuanPablo = {
  id: 'san-juan-pablo',
  nombre: 'Campus San Juan Pablo II',
  cafeteriasActivas: 1,
};

beforeEach(() => {
  localStorage.clear();
  auth.isLoggedIn = false;
  auth.isLoading = false;
  vi.mocked(getCampus).mockResolvedValue([sanFrancisco, sanJuanPablo]);
});
afterEach(cleanup);

function view() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/campus" element={<CampusPage />} />
        <Route path="/catalogo" element={<CatalogEntry />} />
      </Routes>
    </MemoryRouter>,
  );
}

it('ofrece registro e inicio de sesión al visitante', () => {
  view();
  expect(screen.getByRole('link', { name: 'Registrarme gratis' }).getAttribute('href')).toBe('/registro');
  expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe('/login');
});

it.each([
  { isLoggedIn: true, isLoading: false },
  { isLoggedIn: false, isLoading: true },
])('oculta los enlaces de acceso durante una sesión activa o en recuperación (%j)', state => {
  Object.assign(auth, state);
  view();
  expect(screen.queryByRole('link', { name: 'Registrarme gratis' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).toBeNull();
  expect(screen.getByRole('link', { name: /Explorar el catálogo/ })).toBeTruthy();
});

it('pide confirmar el campus desde Inicio aunque ya haya uno guardado', async () => {
  auth.isLoggedIn = true;
  selectCampus(sanFrancisco);
  view();
  fireEvent.click(screen.getByRole('link', { name: /Explorar el catálogo/ }));

  expect(await screen.findByRole('radio', { name: sanFrancisco.nombre })).toHaveProperty('checked', true);
  expect(screen.getByText(sanFrancisco.direccion)).toBeTruthy();
  expect(screen.getByText('2 cafeterías activas')).toBeTruthy();
  expect(screen.getByText('1 cafetería activa')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^Catálogo/ })).toBeNull();

  fireEvent.click(screen.getByRole('radio', { name: sanJuanPablo.nombre }));
  fireEvent.click(screen.getByRole('button', { name: /Continuar al catálogo/ }));
  expect(await screen.findByRole('heading', { name: 'Catálogo san-juan-pablo' })).toBeTruthy();
});
