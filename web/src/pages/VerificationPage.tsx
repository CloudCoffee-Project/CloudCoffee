import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ApiRequestError } from '../services/httpClient';
import { resendVerification, verifyEmail } from '../services/verification';
import './VerificationPage.css';

type VerificationState =
  | { status: 'loading' }
  | { status: 'success'; email: string }
  | { status: 'error'; message: string }
  | { status: 'missing' };

type ResendState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success' }
  | { status: 'error'; message: string };

function verificationErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.type?.endsWith('/token-invalido') || error.status === 400) {
      return 'El enlace de verificación es inválido o expiró. Solicita un nuevo correo para continuar.';
    }
    return error.detail;
  }
  return 'No se pudo verificar el correo. Inténtalo nuevamente.';
}

function resendErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.type?.endsWith('/usuario-no-encontrado') || error.status === 404) {
      return 'No encontramos una cuenta asociada a ese correo.';
    }
    if (error.type?.endsWith('/correo-ya-verificado') || error.status === 409) {
      return 'Esta cuenta ya fue verificada. Puedes iniciar sesión.';
    }
    if (error.status === 429) {
      return 'Has solicitado varios correos. Espera unos minutos antes de volver a intentarlo.';
    }
    return error.detail;
  }
  return 'No se pudo solicitar el reenvío. Inténtalo nuevamente.';
}

export function VerificationPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token')?.trim() ?? '';
  const attemptedToken = useRef<string | null>(null);
  const activeToken = useRef<string | null>(null);
  const [verification, setVerification] = useState<VerificationState>(
    token ? { status: 'loading' } : { status: 'missing' },
  );
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [resend, setResend] = useState<ResendState>({ status: 'idle' });

  useEffect(() => {
    if (!token) {
      activeToken.current = null;
      setVerification({ status: 'missing' });
      return;
    }

    activeToken.current = token;
    setVerification({ status: 'loading' });
    if (attemptedToken.current === token) return;
    attemptedToken.current = token;

    void verifyEmail(token).then(
      (response) => {
        if (activeToken.current === token) {
          setVerification({ status: 'success', email: response.email });
        }
      },
      (error: unknown) => {
        if (activeToken.current === token) {
          setVerification({ status: 'error', message: verificationErrorMessage(error) });
        }
      },
    );
  }, [token]);

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResend({ status: 'loading' });

    try {
      await resendVerification(email.trim());
      setResend({ status: 'success' });
    } catch (error) {
      setResend({ status: 'error', message: resendErrorMessage(error) });
    }
  }

  return (
    <section className="verification-page" aria-labelledby="verification-title">
      <h1 id="verification-title">Verifica tu correo</h1>
      <p className="verification-intro">
        Activa tu cuenta para poder iniciar sesión en CloudCoffee.
      </p>

      {verification.status === 'loading' && (
        <div className="verification-message" role="status" aria-live="polite">
          <LoadingSpinner />
          <p>Verificando tu correo…</p>
        </div>
      )}

      {verification.status === 'success' && (
        <div className="verification-message verification-message--success" role="status">
          <h2>¡Correo verificado!</h2>
          <p>{verification.email} ya puede iniciar sesión.</p>
          <Link className="btn-primary verification-action" to="/login">Iniciar sesión</Link>
        </div>
      )}

      {verification.status === 'error' && (
        <p className="verification-alert" role="alert">{verification.message}</p>
      )}

      {verification.status !== 'success' && verification.status !== 'loading' && (
        <div className="verification-resend">
          {verification.status === 'missing' && (
            <p className="verification-hint">
              Abre el enlace que enviamos a tu correo o solicita que te enviemos uno nuevo.
            </p>
          )}
          <form className="verification-form" onSubmit={handleResend}>
            <label htmlFor="verification-email">Correo electrónico</label>
            <input
              id="verification-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setResend({ status: 'idle' });
              }}
              placeholder="ejemplo@alu.uct.cl"
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={resend.status === 'loading'}
            >
              {resend.status === 'loading' ? 'Enviando…' : 'Reenviar correo de verificación'}
            </button>
          </form>

          {resend.status === 'loading' && (
            <p className="verification-feedback" role="status" aria-live="polite">
              Enviando la solicitud…
            </p>
          )}
          {resend.status === 'success' && (
            <p className="verification-feedback verification-feedback--success" role="status">
              Si la cuenta existe y aún no está verificada, enviaremos un nuevo enlace a {email.trim()}.
              Revisa también tu carpeta de correo no deseado.
            </p>
          )}
          {resend.status === 'error' && (
            <p className="verification-feedback verification-feedback--error" role="alert">
              {resend.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
