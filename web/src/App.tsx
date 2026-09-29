import { Routes, Route } from 'react-router';
import { CatalogPage } from './pages/CatalogPage';
import { HomePage } from './pages/HomePage';
import { MainLayout } from './components/layout/MainLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';

export function App() {
  return (
    <Routes>
      {/* Todo lo que esté DENTRO de esta ruta compartira el Navbar y Footer */}
      <Route element={<MainLayout />}>

        {/* Rutas específicas */}
        <Route path="/" element={<HomePage />} />
        <Route path="/catalogo" element={<CatalogPage />} />

        {/* Pagina 404 para rutas inexistentes */}
        <Route path="*" element={<NotFoundPage />} />

        <Route path="/registro" element={<RegisterPage />} />

      </Route>
    </Routes>
  );
}
