import { useState } from 'react';
import { useNavigate } from 'react-router';
import { request, ApiRequestError } from '../services/httpClient';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // Criterio: Se validan campos antes del envío.
    if (!formData.email || !formData.password) {
      setErrorMsg('Por favor, ingresa tu correo y contraseña.');
      return;
    }

    setIsLoading(true);

    try {
      // Petición al API Gateway (POST /v1/auth/login)
      const response = await request<LoginResponse>('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password
        })
      });

      login(response.accessToken, response.refreshToken);

      // Redirigir tras inicio exitoso
      navigate('/');

    } catch (error) {
      if (error instanceof ApiRequestError) {
        // Criterio: Cuenta no verificada muestra estado específico.
        if (error.type === '/problems/cuenta-no-verificada' || error.status === 403) {
          setErrorMsg('Tu cuenta no ha sido verificada. Revisa tu correo electrónico con las instrucciones.');
        }
        // Criterio: Credenciales incorrectas muestran error claro.
        else if (error.type === '/problems/credenciales-invalidas' || error.status === 401) {
          setErrorMsg('Credenciales incorrectas. Verifica tu correo y contraseña.');
        } else {
          setErrorMsg(error.detail || 'Ocurrió un error al iniciar sesión. Inténtalo de nuevo.');
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
      <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Iniciar Sesión</h2>

      {errorMsg && (
        <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid #fecaca' }}>
          {errorMsg}
        </div>
      )}

      {/* Criterio: Formulario permite ingresar email y password. */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        <div>
          <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Correo Institucional</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            placeholder="ejemplo@alu.uct.cl"
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }}
          />
        </div>

        <div>
          <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Contraseña</label>
          {/* Criterio: Password no queda almacenada ni registrada en logs. */}
          <input
            type="password"
            id="password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
            style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }}
          />
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={isLoading}
          style={{ marginTop: '1rem', opacity: isLoading ? 0.7 : 1, display: 'flex', justifyContent: 'center' }}
        >
          {isLoading ? <span style={{transform: 'scale(0.5)', height: '24px', margin: '-24px 0'}}><LoadingSpinner /></span> : 'Iniciar Sesión'}
        </button>
      </form>
    </div>
  );
}
