import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';
import { ApiRequestError } from '../services/httpClient';
import { getProfile, updateProfile, type Profile, type ProfileChanges } from '../services/profile';
import './ProfilePage.css';

type ProfileFields = Required<ProfileChanges>;
type FieldErrors = Partial<ProfileFields>;

function profileFields(profile: Profile): ProfileFields {
  return {
    nombre: profile.nombre ?? '',
    apellido: profile.apellido ?? '',
    telefono: profile.telefono ?? '',
  };
}

function validateProfile(fields: ProfileFields): FieldErrors {
  const errors: FieldErrors = {};
  if (fields.nombre.length > 100) errors.nombre = 'El nombre no puede superar los 100 caracteres.';
  if (fields.apellido.length > 100) errors.apellido = 'El apellido no puede superar los 100 caracteres.';
  if (fields.telefono && !/^[0-9+ ()-]{6,20}$/.test(fields.telefono)) {
    errors.telefono = 'Usa entre 6 y 20 caracteres: números, +, espacios, paréntesis o guiones.';
  }
  return errors;
}

export function ProfilePage() {
  const { logout } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fields, setFields] = useState<ProfileFields>({ nombre: '', apellido: '', telefono: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const saveRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError('');

    getProfile(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setProfile(data);
        setFields(profileFields(data));
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiRequestError && cause.status === 401) {
          logout();
          return;
        }
        setError(cause instanceof ApiRequestError ? cause.detail : 'No se pudo cargar tu perfil. Inténtalo nuevamente.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => {
      controller.abort();
      saveRequest.current?.abort();
    };
  }, [reload, logout]);

  function changeField(field: keyof ProfileFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError('');
    setSaved(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveRequest.current || !profile) return;
    setError('');
    setSaved(false);

    const values: ProfileFields = {
      nombre: fields.nombre.trim(),
      apellido: fields.apellido.trim(),
      telefono: fields.telefono.trim(),
    };
    const errors = validateProfile(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    // El PATCH conserva los datos omitidos; nunca se envían email ni rol.
    const changes: ProfileChanges = {};
    if (values.nombre) changes.nombre = values.nombre;
    if (values.apellido) changes.apellido = values.apellido;
    if (values.telefono) changes.telefono = values.telefono;

    const controller = new AbortController();
    saveRequest.current = controller;
    setIsSaving(true);
    try {
      const updated = await updateProfile(changes, controller.signal);
      if (controller.signal.aborted) return;
      setProfile(updated);
      setFields(profileFields(updated));
      setSaved(true);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiRequestError) {
        if (cause.status === 401) {
          logout();
          return;
        }
        const errors: FieldErrors = {};
        for (const { field, message } of cause.errors) {
          if (field === 'nombre' || field === 'apellido' || field === 'telefono') errors[field] = message;
        }
        setFieldErrors(errors);
        setError(cause.detail);
      } else {
        setError('No se pudo guardar tu perfil. Inténtalo nuevamente.');
      }
    } finally {
      if (!controller.signal.aborted) {
        saveRequest.current = null;
        setIsSaving(false);
      }
    }
  }

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <h1 id="profile-title">Mi Perfil</h1>
      <p className="profile-intro">Consulta y actualiza tus datos personales.</p>

      {isLoading ? (
        <div role="status">
          <LoadingSpinner />
          <p>Cargando tu perfil…</p>
        </div>
      ) : (
        <>
          {error && <p className="profile-message profile-message--error" role="alert">{error}</p>}
          {!profile ? (
            <button className="btn-primary" type="button" onClick={() => setReload((value) => value + 1)}>
              Reintentar
            </button>
          ) : (
            <form className="profile-form" aria-label="Datos del perfil" noValidate onSubmit={handleSubmit}>
              <p className="profile-hint" id="profile-hint">
                Los campos vacíos conservan el dato guardado. El correo y el rol no se pueden modificar.
              </p>
              <fieldset disabled={isSaving} aria-describedby="profile-hint">
                <legend>Datos personales</legend>
                {(['nombre', 'apellido', 'telefono'] as const).map((field) => (
                  <div className="profile-field" key={field}>
                    <label htmlFor={`profile-${field}`}>
                      {{ nombre: 'Nombre', apellido: 'Apellido', telefono: 'Teléfono' }[field]}
                    </label>
                    <input
                      id={`profile-${field}`}
                      name={field}
                      type={field === 'telefono' ? 'tel' : 'text'}
                      autoComplete={{ nombre: 'given-name', apellido: 'family-name', telefono: 'tel' }[field]}
                      value={fields[field]}
                      onChange={(event) => changeField(field, event.target.value)}
                      aria-invalid={Boolean(fieldErrors[field])}
                      aria-describedby={fieldErrors[field] ? `profile-${field}-error` : undefined}
                    />
                    {fieldErrors[field] && (
                      <p className="profile-field-error" id={`profile-${field}-error`} role="alert">
                        {fieldErrors[field]}
                      </p>
                    )}
                  </div>
                ))}
                <div className="profile-field">
                  <label htmlFor="profile-email">Correo electrónico</label>
                  <input id="profile-email" type="email" value={profile.email} readOnly />
                </div>
                <div className="profile-field">
                  <label htmlFor="profile-role">Rol</label>
                  <input id="profile-role" value={profile.rol} readOnly />
                </div>
              </fieldset>
              <button type="submit" className="btn-primary" disabled={isSaving}>
                {isSaving ? 'Guardando…' : 'Guardar cambios'}
              </button>
              {isSaving && <p role="status">Guardando tu perfil…</p>}
              {saved && <p className="profile-message profile-message--success" role="status">Tu perfil se guardó correctamente.</p>}
            </form>
          )}
        </>
      )}
    </section>
  );
}
