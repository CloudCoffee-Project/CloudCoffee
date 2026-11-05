// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerificationPage } from './VerificationPage';
import { ApiRequestError } from '../services/httpClient';
import { resendVerification, verifyEmail } from '../services/verification';

vi.mock('../services/verification', () => ({
  resendVerification: vi.fn(),
  verifyEmail: vi.fn(),
}));

function renderPage(path = '/verificar-correo') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerificationPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyEmail).mockResolvedValue({ email: 'cliente@example.com', verificado: true });
  vi.mocked(resendVerification).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('verificación de correo web', () => {
  it('verifica automáticamente el token y presenta acceso al login', async () => {
    renderPage('/verificar-correo?token=token-valido');

    expect(await screen.findByRole('heading', { name: '¡Correo verificado!' })).toBeTruthy();
    expect(verifyEmail).toHaveBeenCalledOnce();
    expect(verifyEmail).toHaveBeenCalledWith('token-valido');
    expect(screen.getByText('cliente@example.com ya puede iniciar sesión.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe('/login');
  });

  it('informa que el token inválido o expirado puede renovarse', async () => {
    vi.mocked(verifyEmail).mockRejectedValue(
      new ApiRequestError(400, 'Token inválido', 'El token de verificación es inválido o expiró.', '/problems/token-invalido'),
    );
    renderPage('/verificar-correo?token=token-vencido');

    expect((await screen.findByRole('alert')).textContent).toContain('inválido o expiró');
    expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
  });

  it('permite reenviar con el correo de la URL y confirma la solicitud aceptada', async () => {
    renderPage('/verificar-correo?email=cliente%40example.com');

    const emailInput = screen.getByLabelText('Correo electrónico') as HTMLInputElement;
    expect(emailInput.value).toBe('cliente@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo de verificación' }));

    expect(await screen.findByText(/enviaremos un nuevo enlace/)).toBeTruthy();
    expect(resendVerification).toHaveBeenCalledOnce();
    expect(resendVerification).toHaveBeenCalledWith('cliente@example.com');
  });

  it('muestra errores del Gateway durante el reenvío', async () => {
    vi.mocked(resendVerification).mockRejectedValue(
      new ApiRequestError(429, 'Demasiadas solicitudes', 'Espera antes de volver a intentarlo.'),
    );
    renderPage();
    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'cliente@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar correo de verificación' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Has solicitado varios correos');
    expect(resendVerification).toHaveBeenCalledWith('cliente@example.com');
  });

  it('ofrece el reenvío si no se recibió un token en la URL', () => {
    renderPage();

    expect(screen.getByText(/Abre el enlace que enviamos/)).toBeTruthy();
    expect(screen.getByLabelText('Correo electrónico')).toBeTruthy();
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});
