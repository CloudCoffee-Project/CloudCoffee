import { Routes, Route } from 'react-router';
import { CatalogPage } from './pages/CatalogPage';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/catalogo" element={<CatalogPage />} />
    </Routes>
  );
}
