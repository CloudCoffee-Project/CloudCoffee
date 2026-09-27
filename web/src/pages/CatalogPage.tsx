import { Link } from 'react-router';

export function CatalogPage() {
  return (
    <main>
      <h1>Catálogo</h1>
      <p>El catálogo estará disponible próximamente.</p>
      <Link to="/">Volver al inicio</Link>
    </main>
  );
}
