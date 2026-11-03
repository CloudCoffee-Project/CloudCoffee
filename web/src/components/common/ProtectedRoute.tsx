import { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { UserRole } from '../../utils/jwt';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  children?: ReactNode;
}

export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { isLoggedIn, role } = useAuth();
  const location = useLocation();

  if (!isLoggedIn || !role) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
    const fallbackPath = role === 'CAJERO' ? '/cajero' : '/catalogo';
    const fallbackLabel = role === 'CAJERO' ? 'Ir al panel de cajero' : 'Ir al catálogo';

    return (
      <section
        role="alert"
        style={{
          maxWidth: '520px',
          margin: '3rem auto',
          padding: '2rem',
          textAlign: 'center',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          backgroundColor: 'var(--color-surface, #fff)',
        }}
      >
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Acceso restringido</h1>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
          Tu cuenta con rol <strong>{role}</strong> no tiene permisos para visualizar esta página.
        </p>
        <Link to={fallbackPath} className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
          {fallbackLabel}
        </Link>
      </section>
    );
  }

  return children ? <>{children}</> : <Outlet />;
}