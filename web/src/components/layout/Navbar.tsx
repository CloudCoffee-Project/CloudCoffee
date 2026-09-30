import { NavLink, Link } from 'react-router';

export function Navbar() {
  return (
    <nav className="navbar">
      {/* Logo de la aplicación con ícono SVG */}
      <div className="navbar-brand">
        <NavLink to="/">
          <svg
            width="24" height="24" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
            <line x1="6" y1="1" x2="6" y2="4"></line>
            <line x1="10" y1="1" x2="10" y2="4"></line>
            <line x1="14" y1="1" x2="14" y2="4"></line>
          </svg>
          CloudCoffee.
        </NavLink>
      </div>

      {/* Botones de acción derecha (según Mockup) */}
      <div className="navbar-actions">
        <Link to="/registro" className="nav-link" style={{ marginRight: '1rem', fontWeight: 600 }}>
          Registrarse
        </Link>
        <Link to="/login" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
          Iniciar Sesión
        </Link>
      </div>
    </nav>
  );
}
