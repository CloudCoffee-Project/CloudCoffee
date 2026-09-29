import { Outlet } from 'react-router';
import { Navbar } from './Navbar';
import { Footer } from './Footer';

export function MainLayout() {
  return (
    <div className="layout-wrapper">
      {/* 1. Navegacion siempre arriba */}
      <Navbar />

      {/* 2. El contenido dinámico de cada página (Catalogo, Login, etc.) va aqui */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* 3. Pie de pagina siempre abajo */}
      <Footer />
    </div>
  );
}
