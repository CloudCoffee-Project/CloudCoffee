// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../contexts/AuthContext';
import { ApiRequestError, request } from '../services/httpClient';
import type { Profile } from '../services/profile';
import type { UserRole } from '../utils/jwt';

vi.mock('../config/env', () => ({
  env: {
    appTitle: 'CloudCoffee',
    apiBaseUrl: 'http://localhost:18080',
  },
}));

vi.mock('../services/httpClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/httpClient')>(),
  request: vi.fn(),
}));

const profile: Profile = {
  id: '11111111-1111-4111-8111-111111111111', email: 'ana@example.com',
  nombre: 'Ana', apellido: 'Pérez', telefono: '+56 9 1234 5678', rol: 'CLIENTE',
};

function storeSession(role: UserRole = 'CLIENTE', exp = Math.floor(Date.now() / 1000) + 900) {
  const payload = btoa(JSON.stringify({ sub: profile.id, role, exp }));
  const accessToken = `e30.${payload}.firma`;
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', 'refresh-de-prueba');
  return accessToken;
}

function renderProfile() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/perfil']}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

function input(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'Datos del perfil' }));
}

function writes() {
  return vi.mocked(request).mock.calls.filter(([, options]) => options?.method === 'PATCH');
}

beforeEach(() => {
  localStorage.clear();
  storeSession();
  vi.resetAllMocks();
  vi.mocked(request).mockResolvedValue(profile);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('perfil propio en web (INT2-47)', () => {
  it.each<UserRole>(['CLIENTE', 'CAJERO', 'ADMIN_CAFETERIA', 'SUPER_ADMIN'])(
    'consulta el perfil con sesión de %s y mantiene correo y rol de solo lectura',
    async (role) => {
      storeSession(role);
      vi.mocked(request).mockResolvedValue({ ...profile, rol: role });
      renderProfile();
      expect(screen.getByText('Cargando tu perfil…')).toBeTruthy();
      await screen.findByRole('form');
      expect(input('Nombre').value).toBe('Ana');
      expect(input('Apellido').value).toBe('Pérez');
      expect(input('Teléfono').value).toBe(profile.telefono);
      expect(input('Correo electrónico').value).toBe(profile.email);
      expect(input('Correo electrónico').readOnly).toBe(true);
      expect(input('Rol').value).toBe(role);
      expect(input('Rol').readOnly).toBe(true);
      expect(vi.mocked(request).mock.calls.every(([path, options]) =>
        path === '/v1/auth/users/me' && options?.signal instanceof AbortSignal && !options.omitAccessToken,
      )).toBe(true);
    },
  );

  it.each(['ausente', 'vencida', 'inválida'])('redirige al login sin consultar el perfil si no recupera la sesión %s', async (session) => {
    if (session === 'ausente') localStorage.clear();
    if (session === 'vencida') storeSession('CLIENTE', Math.floor(Date.now() / 1000) - 60);
    if (session === 'inválida') localStorage.setItem('accessToken', 'token-invalido');
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'Iniciar Sesión' })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(session === 'ausente' ? 0 : 1);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it.each(['vencida', 'inválida'])('recupera la sesión %s antes de consultar el perfil', async (session) => {
    const renewedToken = storeSession();
    if (session === 'vencida') storeSession('CLIENTE', Math.floor(Date.now() / 1000) - 60);
    if (session === 'inválida') localStorage.setItem('accessToken', 'token-invalido');
    let resolveRefresh!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    renderProfile();

    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Iniciar Sesión' })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe('http://localhost:18080/v1/auth/refresh');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual({ refreshToken: 'refresh-de-prueba' });

    await act(async () => {
      resolveRefresh(new Response(JSON.stringify({
        accessToken: renewedToken, refreshToken: 'refresh-rotado',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    await screen.findByRole('form', { name: 'Datos del perfil' });
    expect(input('Nombre').value).toBe(profile.nombre);
    expect(request).toHaveBeenCalledWith('/v1/auth/users/me', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(localStorage.getItem('accessToken')).toBe(renewedToken);
    expect(localStorage.getItem('refreshToken')).toBe('refresh-rotado');
  });

  it('guarda solo los campos editables y recarga los valores devueltos por el servidor', async () => {
    renderProfile();
    await screen.findByRole('form');
    fireEvent.change(input('Nombre'), { target: { value: '  Ana María  ' } });
    fireEvent.change(input('Apellido'), { target: { value: '  Soto  ' } });
    fireEvent.change(input('Teléfono'), { target: { value: '+56 (9) 8765-4321' } });
    const updated = { ...profile, nombre: 'Ana María', apellido: 'Soto', telefono: '+56987654321' };
    vi.mocked(request).mockResolvedValue(updated);
    submit();
    await screen.findByText('Tu perfil se guardó correctamente.');
    expect(writes()).toHaveLength(1);
    const [path, options] = writes()[0];
    expect(path).toBe('/v1/auth/users/me');
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(options?.body as string)).toEqual({
      nombre: 'Ana María', apellido: 'Soto', telefono: '+56 (9) 8765-4321',
    });
    expect(input('Nombre').value).toBe(updated.nombre);
    expect(input('Apellido').value).toBe(updated.apellido);
    expect(input('Teléfono').value).toBe(updated.telefono);
    cleanup();
    renderProfile();
    await screen.findByRole('form');
    expect(input('Nombre').value).toBe(updated.nombre);
    expect(input('Teléfono').value).toBe(updated.telefono);
  });

  it.each([
    ['Nombre', 'a'.repeat(101), 'nombre'],
    ['Apellido', 'a'.repeat(101), 'apellido'],
    ['Teléfono', 'abc123456', '6 y 20'],
    ['Teléfono', '12345', '6 y 20'],
    ['Teléfono', '1'.repeat(21), '6 y 20'],
  ])('valida %s antes de enviar el PATCH', async (label, value, message) => {
    renderProfile();
    await screen.findByRole('form');
    fireEvent.change(input(label), { target: { value } });
    submit();
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(input(label).getAttribute('aria-invalid')).toBe('true');
    expect(writes()).toHaveLength(0);
  });

  it('permite edición parcial, omite campos vacíos y acepta datos personales nulos', async () => {
    vi.mocked(request).mockResolvedValue({ ...profile, nombre: null, apellido: null, telefono: null });
    renderProfile();
    await screen.findByRole('form');
    expect(input('Nombre').value).toBe('');
    expect(input('Teléfono').value).toBe('');
    fireEvent.change(input('Nombre'), { target: { value: 'Beatriz' } });
    vi.mocked(request).mockResolvedValue({ ...profile, nombre: 'Beatriz' });
    submit();
    await screen.findByText('Tu perfil se guardó correctamente.');
    expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ nombre: 'Beatriz' });
    expect(input('Apellido').value).toBe('Pérez');
    expect(input('Teléfono').value).toBe(profile.telefono);
  });

  it('bloquea envíos duplicados y edición mientras se guarda', async () => {
    renderProfile();
    await screen.findByRole('form');
    let resolveSave!: (value: Profile) => void;
    vi.mocked(request).mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    submit();
    submit();
    expect(screen.getByText('Guardando tu perfil…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Guardando…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(input('Nombre').closest('fieldset')?.disabled).toBe(true);
    expect(writes()).toHaveLength(1);
    await act(async () => { resolveSave(profile); });
    expect((screen.getByRole('button', { name: 'Guardar cambios' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('muestra validaciones del backend y conserva el borrador para corregirlo y reintentar', async () => {
    renderProfile();
    await screen.findByRole('form');
    fireEvent.change(input('Nombre'), { target: { value: 'Beatriz' } });
    vi.mocked(request).mockRejectedValueOnce(new ApiRequestError(
      400, 'Datos inválidos', 'Revisa los campos indicados.', null, null,
      [{ field: 'telefono', message: 'Teléfono inválido según el servidor.' }],
    ));
    submit();
    await screen.findByText('Teléfono inválido según el servidor.');
    expect(screen.getByText('Revisa los campos indicados.')).toBeTruthy();
    expect(input('Nombre').value).toBe('Beatriz');
    expect(input('Teléfono').getAttribute('aria-describedby')).toBe('profile-telefono-error');
    fireEvent.change(input('Teléfono'), { target: { value: '+56987654321' } });
    expect(screen.queryByText('Teléfono inválido según el servidor.')).toBeNull();
    vi.mocked(request).mockResolvedValueOnce({ ...profile, nombre: 'Beatriz', telefono: '+56987654321' });
    submit();
    await screen.findByText('Tu perfil se guardó correctamente.');
    fireEvent.change(input('Nombre'), { target: { value: 'Ana' } });
    expect(screen.queryByText('Tu perfil se guardó correctamente.')).toBeNull();
  });

  it('permite reintentar la consulta tras un fallo de conexión', async () => {
    vi.mocked(request).mockRejectedValue(new ApiRequestError(null, 'Error de conexión', 'No se pudo conectar con el API Gateway.'));
    renderProfile();
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo conectar');
    expect(screen.queryByRole('form')).toBeNull();
    vi.mocked(request).mockResolvedValue(profile);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('form');
    expect(input('Nombre').value).toBe('Ana');
  });

  it('conserva los cambios y permite reintentar si el servidor falla al guardar', async () => {
    renderProfile();
    await screen.findByRole('form');
    fireEvent.change(input('Nombre'), { target: { value: 'Beatriz' } });
    vi.mocked(request).mockRejectedValueOnce(new ApiRequestError(503, 'No disponible', 'Inténtalo más tarde.'));
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('Inténtalo más tarde.');
    expect(input('Nombre').value).toBe('Beatriz');
    expect(screen.queryByText('Tu perfil se guardó correctamente.')).toBeNull();
    vi.mocked(request).mockResolvedValueOnce({ ...profile, nombre: 'Beatriz' });
    submit();
    await screen.findByText('Tu perfil se guardó correctamente.');
  });

  it.each(['consultar', 'guardar'])('cierra la sesión y vuelve al login si recibe 401 al %s', async (operation) => {
    const unauthorized = new ApiRequestError(401, 'No autorizado', 'La sesión expiró.');
    if (operation === 'consultar') vi.mocked(request).mockRejectedValue(unauthorized);
    renderProfile();
    if (operation === 'guardar') {
      await screen.findByRole('form');
      vi.mocked(request).mockRejectedValueOnce(unauthorized);
      submit();
    }
    await screen.findByRole('heading', { name: 'Iniciar Sesión' });
    expect(screen.queryByRole('form', { name: 'Datos del perfil' })).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });

  it('cancela peticiones al salir e ignora respuestas de una consulta anterior', async () => {
    let resolveFirst!: (value: Profile) => void;
    vi.mocked(request).mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const view = renderProfile();
    await screen.findByRole('form');
    expect(vi.mocked(request).mock.calls[0][1]?.signal?.aborted).toBe(true);
    await act(async () => { resolveFirst({ ...profile, nombre: 'Respuesta obsoleta' }); });
    expect(input('Nombre').value).toBe('Ana');
    vi.mocked(request).mockReturnValueOnce(new Promise(() => {}));
    submit();
    const saveSignal = writes()[0][1]?.signal;
    view.unmount();
    expect(saveSignal?.aborted).toBe(true);
    expect(vi.mocked(request).mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
  });
});
