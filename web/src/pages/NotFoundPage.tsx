import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
      <h1 style={{ fontSize: '4rem', color: 'var(--color-primary)', marginBottom: '1rem' }}>404</h1>
      <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Página no encontrada</h2>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
        Lo sentimos, la página que estás buscando no existe o fue movida.
      </p>
      <Link to="/" className="btn-primary">
        Volver al Inicio
      </Link>
    </div>
  );
}
