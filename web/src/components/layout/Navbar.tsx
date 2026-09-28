import { NavLink } from 'react-router';

export function Navbar() {
  return (
    <nav className="navbar">
      {/* Logo de la aplicacion */}
      <div className="navbar-brand">
        <NavLink to="/">☁️ CloudCoffee</NavLink>
      </div>

      {/* Enlaces principales */}
      <div className="navbar-links">
        <NavLink to="/" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          Inicio
        </NavLink>
        <NavLink to="/catalogo" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
          Catálogo
        </NavLink>
      </div>

      {/* Botones de accion (Carrito, Login) */}
      <div className="navbar-actions">
        {/* Usamos nuestro estilo de botón primario del Paso 1 */}
        <button className="btn-primary">Ingresar</button>
      </div>
    </nav>
  );
}
