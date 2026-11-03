import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiRequestError } from '../services/httpClient';
import { requestPasswordRecovery } from '../services/passwordRecovery';
import './PasswordRecoveryPage.css';

type RecoveryState =
  | { status: 'idle' | 'loading' | 'success' }
  | { status: 'error'; message: string };

export function PasswordRecoveryPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [state, setState] = useState<RecoveryState>({ status: 'idle' });
  const submitting = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || state.status === 'success') return;
    submitting.current = true;
    setState({ status: 'loading' });

    try {
      await requestPasswordRecovery(email.trim());
      setState({ status: 'success' });
    } catch (error) {
      const message = error instanceof ApiRequestError && error.status === 429
        ? 'Has solicitado varios correos. Espera unos minutos antes de volver a intentarlo.'
        : error instanceof ApiRequestError
          ? error.detail
          : 'No se pudo solicitar la recuperación. Inténtalo nuevamente.';
      setState({ status: 'error', message });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className="password-page" aria-labelledby="recovery-title">
      <h1 id="recovery-title">Recuperar contraseña</h1>
      <p className="password-intro">Te enviaremos un enlace para restablecer tu contraseña.</p>

      {state.status === 'success' ? (
        <p className="password-message password-message--success" role="status">
          Si existe una cuenta activa asociada a ese correo, recibirás un enlace para restablecer
          tu contraseña. Revisa también tu carpeta de correo no deseado. El enlace vence en una hora.
        </p>
      ) : (
        <form className="password-form" onSubmit={handleSubmit} aria-busy={state.status === 'loading'}>
          <label htmlFor="recovery-email">Correo electrónico</label>
          <input
            id="recovery-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={state.status === 'loading'}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={state.status === 'loading'}>
            {state.status === 'loading' ? 'Enviando…' : 'Enviar enlace de recuperación'}
          </button>
        </form>
      )}

      {state.status === 'loading' && <p className="password-message" role="status">Enviando la solicitud…</p>}
      {state.status === 'error' && <p className="password-message password-message--error" role="alert">{state.message}</p>}
      <Link className="password-link" to="/login">Volver a iniciar sesión</Link>
    </section>
  );
}
