import { startTransition, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { ApiRequestError } from '../services/httpClient';
import { changePassword } from '../services/profile';
import './ProfilePage.css';

const labels = {
  passwordActual: 'Contraseña actual',
  passwordNueva: 'Nueva contraseña',
  confirmation: 'Confirmar nueva contraseña',
};
type PasswordFields = Record<keyof typeof labels, string>;

export function PasswordChangePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState<PasswordFields>({ passwordActual: '', passwordNueva: '', confirmation: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<PasswordFields>>({});
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const pendingRequest = useRef<AbortController | null>(null);

  useEffect(() => () => pendingRequest.current?.abort(), []);

  function changeField(field: keyof PasswordFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
    setFieldErrors({});
    setError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRequest.current) return;
    setError('');
    const errors: Partial<PasswordFields> = {};
    if (!fields.passwordActual.trim()) errors.passwordActual = 'Ingresa tu contraseña actual.';
    if (!fields.passwordNueva.trim() || fields.passwordNueva.length < 6) {
      errors.passwordNueva = 'La nueva contraseña debe tener al menos 6 caracteres y no puede contener solo espacios.';
    }
    if (!fields.confirmation || fields.confirmation !== fields.passwordNueva) {
      errors.confirmation = 'Las contraseñas no coinciden.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const controller = new AbortController();
    pendingRequest.current = controller;
    setIsSaving(true);
    try {
      await changePassword(fields.passwordActual, fields.passwordNueva, controller.signal);
      if (controller.signal.aborted) return;
      setFields({ passwordActual: '', passwordNueva: '', confirmation: '' });
      // Actualizar sesión y ruta juntas evita que ProtectedRoute reemplace el aviso de éxito.
      startTransition(() => {
        logout();
        navigate('/login', { replace: true, state: { passwordChanged: true } });
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiRequestError) {
        if (cause.type === '/problems/contrasena-actual-incorrecta') {
          setFieldErrors({ passwordActual: cause.detail });
        } else if (cause.status === 401) {
          logout();
        } else {
          const errors: Partial<PasswordFields> = {};
          for (const { field, message } of cause.errors) {
            if (field === 'passwordActual' || field === 'passwordNueva') errors[field] = message;
          }
          setFieldErrors(errors);
          setError(cause.detail);
        }
      } else {
        setError('No se pudo cambiar tu contraseña. Inténtalo nuevamente.');
      }
    } finally {
      if (!controller.signal.aborted) {
        pendingRequest.current = null;
        setIsSaving(false);
      }
    }
  }

  return (
    <section className="profile-page" aria-labelledby="password-change-title">
      <h1 id="password-change-title">Cambiar contraseña</h1>
      <p className="profile-intro">
        Se cerrará tu sesión en esta web al guardar. En los demás dispositivos,
        deberás iniciar sesión de nuevo cuando expire el acceso actual.
      </p>
      <form className="profile-form" aria-label="Cambiar contraseña" aria-busy={isSaving} noValidate onSubmit={handleSubmit}>
        <fieldset disabled={isSaving}>
          <legend>Seguridad de la cuenta</legend>
          {(Object.keys(labels) as (keyof PasswordFields)[]).map((field) => (
            <div className="profile-field" key={field}>
              <label htmlFor={`change-${field}`}>{labels[field]}</label>
              <input
                id={`change-${field}`}
                name={field}
                type="password"
                autoComplete={field === 'passwordActual' ? 'current-password' : 'new-password'}
                required
                minLength={field === 'passwordActual' ? undefined : 6}
                value={fields[field]}
                onChange={(event) => changeField(field, event.target.value)}
                aria-invalid={Boolean(fieldErrors[field])}
                aria-describedby={fieldErrors[field] ? `change-${field}-error` : field !== 'passwordActual' ? 'change-password-hint' : undefined}
              />
              {fieldErrors[field] && (
                <p id={`change-${field}-error`} className="profile-field-error" role="alert">{fieldErrors[field]}</p>
              )}
            </div>
          ))}
          <p id="change-password-hint" className="profile-hint">Usa al menos 6 caracteres para la nueva contraseña.</p>
        </fieldset>
        <button type="submit" className="btn-primary" disabled={isSaving}>
          {isSaving ? 'Guardando…' : 'Guardar contraseña'}
        </button>
        {isSaving && <p role="status">Actualizando tu contraseña…</p>}
        {error && <p className="profile-message profile-message--error" role="alert">{error}</p>}
        <Link to="/perfil">Volver al perfil</Link>
      </form>
    </section>
  );
}
