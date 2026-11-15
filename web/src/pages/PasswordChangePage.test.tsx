// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../contexts/AuthContext';
import type { UserRole } from '../utils/jwt';

vi.mock('../config/env', () => ({
  env: { apiBaseUrl: 'http://localhost:18080', appTitle: 'CloudCoffee' },
}));

const fetcher = vi.fn<typeof fetch>();
const path = '/perfil/cambiar-contrasena';
const incorrectPassword = '/problems/contrasena-actual-incorrecta';

function sessionToken(role: UserRole, exp = Math.floor(Date.now() / 1000) + 900) {
  return `e30.${btoa(JSON.stringify({ sub: '11111111-1111-4111-8111-111111111111', role, exp }))}.firma`;
}

function storeSession(role: UserRole = 'CLIENTE', exp = Math.floor(Date.now() / 1000) + 900) {
  const token = sessionToken(role, exp);
  localStorage.setItem('accessToken', token);
  localStorage.setItem('refreshToken', 'refresh-anterior');
  return token;
}

function renderApp(initialPath = path) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider><App /><Link to={path}>Abrir cambio de contraseña</Link></AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

function input(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function submit(current = 'Actual123!', password = 'Nueva123!', confirmation = password) {
  fireEvent.change(input('Contraseña actual'), { target: { value: current } });
  fireEvent.change(input('Nueva contraseña'), { target: { value: password } });
  fireEvent.change(input('Confirmar nueva contraseña'), { target: { value: confirmation } });
  fireEvent.submit(screen.getByRole('form', { name: 'Cambiar contraseña' }));
}

function problem(status: number, detail: string, type = '/problems/error', errors: object[] = []) {
  return new Response(JSON.stringify({ status, title: 'Error', detail, type, errors }), {
    status, headers: { 'Content-Type': 'application/problem+json' },
  });
}

function renewedSession() {
  const accessToken = sessionToken('CAJERO');
  return new Response(JSON.stringify({ accessToken, refreshToken: 'refresh-renovado' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
  storeSession();
  fetcher.mockReset();
  fetcher.mockImplementation(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('cambio de contraseña desde perfil web (INT2-95)', () => {
  it('enlaza desde el perfil a un formulario separado de los datos personales', async () => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({
      id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com',
      nombre: 'Ana', apellido: 'Pérez', telefono: null, rol: 'CLIENTE',
    }), { headers: { 'Content-Type': 'application/json' } }));
    renderApp('/perfil');
    await screen.findByRole('form', { name: 'Datos del perfil' });
    fireEvent.click(screen.getByRole('link', { name: 'Cambiar contraseña' }));
    expect(screen.getByRole('form', { name: 'Cambiar contraseña' })).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Datos del perfil' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Volver al perfil' }).getAttribute('href')).toBe('/perfil');
  });

  it.each<UserRole>(['CLIENTE', 'CAJERO', 'ADMIN_CAFETERIA', 'SUPER_ADMIN'])(
    'permite cambiar la contraseña con sesión de %s e informa la política de sesiones', (role) => {
      storeSession(role);
      renderApp();
      expect(input('Contraseña actual').type).toBe('password');
      expect(input('Contraseña actual').autocomplete).toBe('current-password');
      expect(input('Nueva contraseña').autocomplete).toBe('new-password');
      expect(input('Confirmar nueva contraseña').type).toBe('password');
      expect(screen.getByText(/Se cerrará tu sesión en esta web/).textContent).toContain('demás dispositivos');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(['ausente', 'vencida', 'inválida'])('requiere sesión válida cuando está %s', async (session) => {
    if (session === 'ausente') localStorage.clear();
    if (session === 'vencida') storeSession('CLIENTE', Math.floor(Date.now() / 1000) - 60);
    if (session === 'inválida') localStorage.setItem('accessToken', 'invalido');
    fetcher.mockImplementation(async () => problem(401, 'La sesión expiró.'));
    renderApp();
    await screen.findByRole('heading', { name: 'Iniciar Sesión' });
    expect(screen.queryByRole('form', { name: 'Cambiar contraseña' })).toBeNull();
    expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(0);
  });

  it.each([
    ['', 'Nueva123!', 'Nueva123!', 'Ingresa tu contraseña actual.'],
    ['   ', 'Nueva123!', 'Nueva123!', 'Ingresa tu contraseña actual.'],
    ['Actual123!', '', '', 'al menos 6 caracteres'],
    ['Actual123!', '12345', '12345', 'al menos 6 caracteres'],
    ['Actual123!', '      ', '      ', 'solo espacios'],
    ['Actual123!', 'Nueva123!', 'Otra123!', 'no coinciden'],
  ])('valida los campos antes de enviar (%s, %s, %s)', (current, password, confirmation, message) => {
    renderApp();
    submit(current, password, confirmation);
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes(message))).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(localStorage.getItem('refreshToken')).toBe('refresh-anterior');
  });

  it('envía el contrato autenticado sin recortar contraseñas y cierra la sesión local al recibir 200 vacío', async () => {
    const token = localStorage.getItem('accessToken');
    renderApp();
    submit(' Actual123! ', ' Ab12 ');
    await screen.findByRole('heading', { name: 'Iniciar Sesión' });
    expect(screen.getByRole('status').textContent).toContain('Tu contraseña fue actualizada');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://localhost:18080/v1/auth/users/me/password');
    expect(options?.method).toBe('PATCH');
    expect(new Headers(options?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(options?.body as string)).toEqual({ passwordActual: ' Actual123! ', passwordNueva: ' Ab12 ' });
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('link', { name: 'Abrir cambio de contraseña' }));
    expect(screen.queryByRole('form', { name: 'Cambiar contraseña' })).toBeNull();
    expect(input('Contraseña').value).toBe('');
  });

  it('conserva la sesión ante contraseña actual incorrecta, muestra el error y permite corregir y reintentar', async () => {
    const token = localStorage.getItem('accessToken');
    fetcher.mockResolvedValueOnce(problem(401, 'La contraseña actual no coincide.', incorrectPassword));
    renderApp();
    submit();
    await screen.findByText('La contraseña actual no coincide.');
    expect(input('Contraseña actual').getAttribute('aria-invalid')).toBe('true');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(localStorage.getItem('accessToken')).toBe(token);
    expect(localStorage.getItem('refreshToken')).toBe('refresh-anterior');
    submit('Corregida123!');
    await screen.findByRole('heading', { name: 'Iniciar Sesión' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toContain('Tu contraseña fue actualizada');
  });

  it('conserva la sesión renovada si la contraseña actual incorrecta llega tras reintentar con el nuevo JWT', async () => {
    const response = renewedSession();
    fetcher.mockResolvedValueOnce(problem(401, 'JWT vencido.'))
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(problem(401, 'Contraseña incorrecta tras renovar.', incorrectPassword));
    renderApp();
    submit();
    await screen.findByText('Contraseña incorrecta tras renovar.');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[1][0])).toBe('http://localhost:18080/v1/auth/refresh');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-renovado');
    expect(screen.queryByRole('heading', { name: 'Iniciar Sesión' })).toBeNull();
  });

  it('renueva un JWT rechazado, reintenta el cambio y limpia ambos tokens después del éxito', async () => {
    const response = renewedSession();
    const { accessToken } = await response.clone().json();
    fetcher.mockResolvedValueOnce(problem(401, 'JWT vencido.')).mockResolvedValueOnce(response);
    renderApp();
    submit();
    await screen.findByText('Tu contraseña fue actualizada. Inicia sesión con tu nueva contraseña.');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][1]?.body).toBe(fetcher.mock.calls[0][1]?.body);
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('Authorization')).toBe(`Bearer ${accessToken}`);
    expect(localStorage.length).toBe(0);
  });

  it('redirige al login si la sesión realmente expiró y el refresh ya no es válido', async () => {
    fetcher.mockResolvedValueOnce(problem(401, 'JWT vencido.'))
      .mockResolvedValueOnce(problem(401, 'Refresh revocado.', '/problems/refresh-token-invalido'));
    renderApp();
    submit();
    await screen.findByRole('heading', { name: 'Iniciar Sesión' });
    expect(localStorage.length).toBe(0);
    expect(screen.queryByRole('status')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('muestra las validaciones de campo devueltas por el backend', async () => {
    fetcher.mockResolvedValueOnce(problem(400, 'Revisa los campos.', '/problems/validation', [
      { field: 'passwordNueva', message: 'La nueva contraseña no es válida.' },
    ]));
    renderApp();
    submit();
    await screen.findByText('La nueva contraseña no es válida.');
    expect(input('Nueva contraseña').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Revisa los campos.')).toBeTruthy();
    expect(localStorage.getItem('refreshToken')).toBe('refresh-anterior');
  });

  it.each([null, 429, 500])('muestra fallos de red o HTTP %s sin cerrar sesión y permite reintentar', async (status) => {
    if (status === null) fetcher.mockRejectedValueOnce(new TypeError('Conexión perdida'));
    else fetcher.mockResolvedValueOnce(problem(status, 'Inténtalo más tarde.'));
    renderApp();
    submit();
    await screen.findByRole('alert');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-anterior');
    expect(input('Nueva contraseña').value).toBe('Nueva123!');
    submit();
    await screen.findByRole('heading', { name: 'Iniciar Sesión' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('bloquea edición y envíos duplicados mientras guarda', async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderApp();
    submit();
    fireEvent.submit(screen.getByRole('form', { name: 'Cambiar contraseña' }));
    expect(input('Contraseña actual').closest('fieldset')?.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Guardando…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Actualizando');
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await act(async () => { resolve(new Response(null, { status: 200 })); });
    expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeTruthy();
  });

  it('cancela al salir e ignora la respuesta tardía sin cerrar la sesión', async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderApp();
    submit();
    const signal = fetcher.mock.calls[0][1]?.signal;
    cleanup();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(new Response(null, { status: 200 })); });
    expect(localStorage.getItem('refreshToken')).toBe('refresh-anterior');
  });
});
