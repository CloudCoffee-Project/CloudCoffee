import { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { CART_UPDATED_EVENT, readCartItems } from '../../services/catalog';

export function Navbar() {
  const { isLoggedIn, role, logout } = useAuth();
  const navigate = useNavigate();
  const [cartQuantity, setCartQuantity] = useState(() => (
    readCartItems().reduce((total, item) => total + item.quantity, 0)
  ));

  useEffect(() => {
    const refreshCartQuantity = () => {
      setCartQuantity(readCartItems().reduce((total, item) => total + item.quantity, 0));
    };
    window.addEventListener(CART_UPDATED_EVENT, refreshCartQuantity);
    window.addEventListener('storage', refreshCartQuantity);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, refreshCartQuantity);
      window.removeEventListener('storage', refreshCartQuantity);
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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

      <div className="navbar-links">
        <NavLink
          to="/catalogo"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          Catálogo
        </NavLink>
        <NavLink
          to="/carrito"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          aria-label={`Carrito, ${cartQuantity} ${cartQuantity === 1 ? 'producto' : 'productos'}`}
        >
          Carrito ({cartQuantity})
        </NavLink>
      </div>

      {/* Botones de acción derecha según sesión y rol */}
      <div className="navbar-actions">
        {isLoggedIn ? (
          <>
            {role === 'CAJERO' && (
              <Link to="/cajero" className="nav-link" style={{ marginRight: '1rem', fontWeight: 600 }}>
                Panel Cajero
              </Link>
            )}
            {role === 'CLIENTE' && (
              <Link to="/compras" className="nav-link" style={{ marginRight: '1rem', fontWeight: 600 }}>
                Mis Compras
              </Link>
            )}
            <Link to="/perfil" className="nav-link" style={{ marginRight: '1rem', fontWeight: 600 }}>
              Mi Perfil
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="btn-primary"
              style={{ cursor: 'pointer', border: 'none' }}
            >
              Cerrar Sesión
            </button>
          </>
        ) : (
          <>
            <Link to="/registro" className="nav-link" style={{ marginRight: '1rem', fontWeight: 600 }}>
              Registrarse
            </Link>
            <Link to="/login" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Iniciar Sesión
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}