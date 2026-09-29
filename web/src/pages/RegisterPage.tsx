import { useState } from 'react';
import { request, ApiRequestError } from '../services/httpClient';
import { LoadingSpinner } from '../components/common/LoadingSpinner';

export function RegisterPage() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: ''
  });

  const [isLoading, setIsLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!formData.firstName || !formData.lastName || !formData.email || !formData.password || !formData.phone) {
      setErrorMsg('Por favor, completa todos los campos obligatorios.');
      return;
    }

    setIsLoading(true);

    try {
      await request('/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      setSuccessMsg('Cuenta creada exitosamente! Por favor revisa tu bandeja de entrada para verificar tu correo antes de iniciar sesion.');

      setFormData({ firstName: '', lastName: '', email: '', phone: '', password: '' });

    } catch (error) {
      if (error instanceof ApiRequestError) {

        if (error.status === 409 || error.detail?.toLowerCase().includes('email')) {
          setErrorMsg('Ese email ya se encuentra registrado. Intenta iniciar sesión o usa otro correo.');
        } else {
          setErrorMsg(error.detail || 'Ocurrió un error al registrar el cliente. Inténtalo de nuevo.');
        }
      } else {
        setErrorMsg('Error de conexión al servidor.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '0 auto', paddingTop: '2rem' }}>
      <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Crear una cuenta</h2>

      {successMsg && (
        <div style={{ padding: '1rem', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #bbf7d0' }}>
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #fecaca' }}>
          {errorMsg}
        </div>
      )}

      {!successMsg && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="firstName" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Nombre *</label>
              <input type="text" id="firstName" name="firstName" value={formData.firstName} onChange={handleChange} required style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="lastName" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Apellido *</label>
              <input type="text" id="lastName" name="lastName" value={formData.lastName} onChange={handleChange} required style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }} />
            </div>
          </div>

          <div>
            <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Correo Institucional *</label>
            <input type="email" id="email" name="email" value={formData.email} onChange={handleChange} required placeholder="ejemplo@alu.uct.cl" style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }} />
          </div>

          <div>
            <label htmlFor="phone" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Teléfono *</label>
            <input type="tel" id="phone" name="phone" value={formData.phone} onChange={handleChange} required placeholder="+569..." style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }} />
          </div>

          <div>
            <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Contraseña *</label>
            <input type="password" id="password" name="password" value={formData.password} onChange={handleChange} required minLength={6} style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }} />
          </div>

          <button type="submit" className="btn-primary" disabled={isLoading} style={{ marginTop: '1rem', opacity: isLoading ? 0.7 : 1, display: 'flex', justifyContent: 'center' }}>
            {isLoading ? <span style={{transform: 'scale(0.5)', height: '24px', margin: '-24px 0'}}><LoadingSpinner /></span> : 'Registrarse'}
          </button>
        </form>
      )}
    </div>
  );
}
