// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../contexts/AuthContext';

vi.mock('../config/env', () => ({
  env: { apiBaseUrl: 'https://gateway.example.com', appTitle: 'CloudCoffee' },
}));

const fetcher = vi.fn<typeof fetch>();

function renderApp(path: string, nextPath?: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
        {nextPath && <Link to={nextPath}>Abrir otro enlace</Link>}
      </AuthProvider>
    </MemoryRouter>,
  );
}

function submitRecovery(email = 'cliente@example.com') {
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }));
}

function submitReset(password = 'NuevaPassword123!', confirmation = password) {
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: confirmation } });
  fireEvent.submit(screen.getByRole('button', { name: 'Restablecer contraseña' }).closest('form')!);
}

function problem(status: number, detail: string, type = '/problems/error') {
  return new Response(JSON.stringify({ status, title: 'Error', detail, type }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

function expectRequest(index: number, path: string, body: object) {
  const [url, options] = fetcher.mock.calls[index];
  expect(url.toString()).toBe(`https://gateway.example.com${path}`);
  expect(options?.method).toBe('POST');
  expect(JSON.parse(options?.body as string)).toEqual(body);
  expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json');
  expect(new Headers(options?.headers).has('Authorization')).toBe(false);
}

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('recuperación y reset web (INT2-68)', () => {
  it('enlaza desde login con el correo ingresado y confirma la solicitud sin revelar cuentas', async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 202 }));
    renderApp('/login');
    fireEvent.change(screen.getByLabelText('Correo Institucional'), {
      target: { value: 'cliente+web@example.com' },
    });
    fireEvent.click(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' }));

    expect((screen.getByLabelText('Correo electrónico') as HTMLInputElement).value).toBe('cliente+web@example.com');
    // Una sesión local vencida no debe impedir recuperar el acceso.
    localStorage.setItem('accessToken', 'jwt-vencido');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }));

    expect(screen.getByRole('status').textContent).toContain('Enviando');
    expect(await screen.findByText(/Si existe una cuenta activa/)).toBeTruthy();
    expectRequest(0, '/v1/auth/password/recovery', { email: 'cliente+web@example.com' });
    expect(screen.queryByRole('button', { name: 'Enviar enlace de recuperación' })).toBeNull();
  });

  it('bloquea envíos duplicados durante la solicitud', async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    renderApp('/recuperar-contrasena');
    submitRecovery();
    const button = screen.getByRole('button', { name: 'Enviando…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.submit(button.closest('form')!);
    expect(fetcher).toHaveBeenCalledOnce();

    await act(async () => resolve(new Response(null, { status: 202 })));
    expect(await screen.findByText(/Si existe una cuenta activa/)).toBeTruthy();
  });

  it('valida correo obligatorio y su formato antes del envío', () => {
    renderApp('/recuperar-contrasena');
    const email = screen.getByLabelText('Correo electrónico') as HTMLInputElement;
    expect(email.checkValidity()).toBe(false);
    submitRecovery('correo-invalido');
    expect(email.checkValidity()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [429, 'Has solicitado varios correos'],
    [503, 'Servicio temporalmente no disponible'],
  ])('muestra el error %s y permite reintentar la solicitud', async (status, message) => {
    fetcher.mockResolvedValueOnce(problem(status, 'Servicio temporalmente no disponible'))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    renderApp('/recuperar-contrasena');
    submitRecovery();
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace de recuperación' }));
    expect(await screen.findByText(/Si existe una cuenta activa/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('presenta el error de conexión de la solicitud', async () => {
    fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    renderApp('/recuperar-contrasena');
    submitRecovery();
    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo conectar');
  });

  it.each(['', '?token=', '?token=%20%20'])('ofrece otro enlace si falta el token: %s', (query) => {
    renderApp(`/restablecer-contrasena${query}`);
    expect(screen.getByRole('alert').textContent).toContain('Falta el token');
    expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Solicitar nuevo enlace' }));
    expect(screen.getByRole('heading', { name: 'Recuperar contraseña' })).toBeTruthy();
  });

  it.each([
    ['corta', 'corta', 'al menos 8 caracteres'],
    ['        ', '        ', 'solo espacios'],
    ['NuevaPassword123!', 'OtraPassword123!', 'no coinciden'],
  ])('valida la nueva contraseña sin consumir el token: %s', (password, confirmation, message) => {
    renderApp('/restablecer-contrasena?token=valido');
    submitReset(password, confirmation);
    expect(screen.getByRole('alert').textContent).toContain(message);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('envía el token del correo una sola vez, muestra carga y permite login con la nueva contraseña', async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockReturnValueOnce(new Promise<Response>((done) => { resolve = done; }));
    renderApp('/restablecer-contrasena?token=token%2Bcon%2Fsimbolos%3D');
    localStorage.setItem('accessToken', 'jwt-vencido');
    expect(fetcher).not.toHaveBeenCalled();
    submitReset();

    const button = screen.getByRole('button', { name: 'Guardando…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Actualizando');
    fireEvent.submit(button.closest('form')!);
    expect(fetcher).toHaveBeenCalledOnce();
    expectRequest(0, '/v1/auth/password/reset', {
      token: 'token+con/simbolos=', nuevaPassword: 'NuevaPassword123!',
    });

    await act(async () => resolve(new Response(null, { status: 204 })));
    expect(await screen.findByText(/Tu contraseña fue actualizada/)).toBeTruthy();
    expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();
    expect(localStorage.getItem('nuevaPassword')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();

    const jwt = `${btoa('{}')}.${btoa(JSON.stringify({ sub: 'usuario', role: 'CLIENTE', exp: Math.floor(Date.now() / 1000) + 900 }))}.firma`;
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: jwt, refreshToken: 'refresh' }), {
      headers: { 'Content-Type': 'application/json' },
    }));
    fireEvent.click(screen.getByRole('link', { name: 'Iniciar sesión' }));
    fireEvent.change(screen.getByLabelText('Correo Institucional'), { target: { value: 'cliente@example.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'NuevaPassword123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar Sesión' }));
    await waitFor(() => expect(localStorage.getItem('accessToken')).toBe(jwt));
    expectRequest(1, '/v1/auth/login', { email: 'cliente@example.com', password: 'NuevaPassword123!' });
  });

  it.each(['invalido', 'expirado', 'consumido'])('muestra el token %s y permite solicitar otro enlace', async (token) => {
    fetcher.mockResolvedValue(problem(400, 'Token inválido', '/problems/token-recuperacion-invalido'));
    renderApp(`/restablecer-contrasena?token=${token}`);
    submitReset();
    expect((await screen.findByRole('alert')).textContent).toContain('inválido, expiró o ya fue utilizado');
    expect(screen.queryByLabelText('Nueva contraseña')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Solicitar nuevo enlace' }));
    expect(screen.getByRole('heading', { name: 'Recuperar contraseña' })).toBeTruthy();
  });

  it.each([400, 429, 503, null])('permite reintentar reset ante error %s sin tratarlo como token inválido', async (status) => {
    if (status === null) fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else fetcher.mockResolvedValueOnce(problem(status, 'No se pudo guardar.'));
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderApp('/restablecer-contrasena?token=valido');
    submitReset();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Nueva contraseña')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await screen.findByText(/Tu contraseña fue actualizada/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reinicia el formulario al abrir otro token en la misma página', async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
    renderApp('/restablecer-contrasena?token=primero', '/restablecer-contrasena?token=segundo');
    submitReset();
    expect(await screen.findByText(/Tu contraseña fue actualizada/)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Abrir otro enlace' }));
    expect((screen.getByLabelText('Nueva contraseña') as HTMLInputElement).value).toBe('');
    submitReset();
    await screen.findByText(/Tu contraseña fue actualizada/);
    expectRequest(1, '/v1/auth/password/reset', { token: 'segundo', nuevaPassword: 'NuevaPassword123!' });
  });
});
