import { Link } from 'react-router';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="footer">
      <div>
        <p>&copy; {currentYear} CloudCoffee. Todos los derechos reservados.</p>
      </div>

      <div className="footer-links">
        <Link to="/terminos" className="footer-link">Términos de servicio</Link>
        <Link to="/privacidad" className="footer-link">Privacidad</Link>
        <Link to="/contacto" className="footer-link">Contacto</Link>
      </div>
    </footer>
  );
}
