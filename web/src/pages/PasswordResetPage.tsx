import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiRequestError } from '../services/httpClient';
import { resetPassword } from '../services/passwordRecovery';
import './PasswordRecoveryPage.css';

type ResetState =
  | { status: 'idle' | 'loading' | 'success' }
  | { status: 'invalid' | 'error'; message: string };

function PasswordResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState<ResetState>({ status: 'idle' });
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || state.status === 'success' || state.status === 'invalid') return;
    if (password.length < 8 || !password.trim()) {
      setState({ status: 'error', message: 'La contraseña debe tener al menos 8 caracteres y no puede contener solo espacios.' });
      return;
    }
    if (password !== confirmation) {
      setState({ status: 'error', message: 'Las contraseñas no coinciden.' });
      return;
    }

    submitting.current = true;
    setState({ status: 'loading' });
    try {
      await resetPassword(token, password);
      setPassword('');
      setConfirmation('');
      setState({ status: 'success' });
    } catch (error) {
      if (error instanceof ApiRequestError && error.type?.endsWith('/token-recuperacion-invalido')) {
        setPassword('');
        setConfirmation('');
        setState({ status: 'invalid', message: 'El enlace es inválido, expiró o ya fue utilizado. Solicita uno nuevo para continuar.' });
      } else {
        const message = error instanceof ApiRequestError && error.status === 429
          ? 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.'
          : error instanceof ApiRequestError
            ? error.detail
            : 'No se pudo restablecer la contraseña. Inténtalo nuevamente.';
        setState({ status: 'error', message });
      }
    } finally {
      submitting.current = false;
    }
  }

  if (state.status === 'success') {
    return (
      <>
        <p className="password-message password-message--success" role="status">
          Tu contraseña fue actualizada. Ya puedes iniciar sesión con tu nueva contraseña.
        </p>
        <Link className="btn-primary password-action" to="/login">Iniciar sesión</Link>
      </>
    );
  }

  if (state.status === 'invalid') {
    return <RecoveryLink message={state.message} />;
  }

  return (
    <>
      <p className="password-intro">Ingresa y confirma tu nueva contraseña.</p>
      <form className="password-form" onSubmit={handleSubmit} aria-busy={state.status === 'loading'}>
        <label htmlFor="reset-password">Nueva contraseña</label>
        <input
          id="reset-password"
          name="nuevaPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-describedby="password-requirements"
          disabled={state.status === 'loading'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p id="password-requirements" className="password-hint">Usa al menos 8 caracteres.</p>
        <label htmlFor="reset-confirmation">Confirmar contraseña</label>
        <input
          id="reset-confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={state.status === 'loading'}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Guardando…' : 'Restablecer contraseña'}
        </button>
      </form>
      {state.status === 'loading' && <p className="password-message" role="status">Actualizando la contraseña…</p>}
      {state.status === 'error' && <p className="password-message password-message--error" role="alert">{state.message}</p>}
      <Link className="password-link" to="/login">Volver a iniciar sesión</Link>
    </>
  );
}

function RecoveryLink({ message }: { message: string }) {
  return (
    <>
      <p className="password-message password-message--error" role="alert">{message}</p>
      <Link className="btn-primary password-action" to="/recuperar-contrasena">Solicitar nuevo enlace</Link>
    </>
  );
}

export function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';

  return (
    <section className="password-page" aria-labelledby="reset-title">
      <h1 id="reset-title">Restablecer contraseña</h1>
      {token
        ? <PasswordResetForm key={token} token={token} />
        : <RecoveryLink message="Falta el token de recuperación. Abre el enlace recibido por correo o solicita uno nuevo." />}
    </section>
  );
}
