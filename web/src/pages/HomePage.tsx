import { Link } from 'react-router';
import { env } from '../config/env';

export function HomePage() {
  return (
    <main>
      <h1>{env.appTitle}</h1>
      <p>Aplicación web de CloudCoffee.</p>
      <Link to="/catalogo">Ir al catálogo</Link>
    </main>
  );
}
