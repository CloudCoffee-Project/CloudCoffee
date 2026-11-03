import { Routes, Route } from 'react-router';
import { CatalogPage } from './pages/CatalogPage';
import { HomePage } from './pages/HomePage';
import { MainLayout } from './components/layout/MainLayout';
import { NotFoundPage } from './pages/NotFoundPage';
import { RegisterPage } from './pages/RegisterPage';
import { LoginPage } from './pages/LoginPage';
import { VerificationPage } from './pages/VerificationPage';
import { PasswordRecoveryPage } from './pages/PasswordRecoveryPage';
import { PasswordResetPage } from './pages/PasswordResetPage';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { ProfilePage } from './pages/ProfilePage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CartPage } from './pages/CartPage';

export function App() {
  return (
    <Routes>
      {/* Todo lo que esté DENTRO de esta ruta compartira el Navbar y Footer */}
      <Route element={<MainLayout />}>

        {/* Rutas públicas */}
        <Route path="/" element={<HomePage />} />
        <Route path="/catalogo" element={<CatalogPage />} />
        <Route path="/catalogo/productos/:id" element={<ProductDetailPage />} />
        <Route path="/carrito" element={<CartPage />} />
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verificar-correo" element={<VerificationPage />} />
        <Route path="/recuperar-contrasena" element={<PasswordRecoveryPage />} />
        <Route path="/restablecer-contrasena" element={<PasswordResetPage />} />

        {/* Rutas privadas para cualquier usuario con sesión */}
        <Route element={<ProtectedRoute />}>
          <Route path="/perfil" element={<ProfilePage />} />
        </Route>

        {/* Rutas exclusivas de comprador (CLIENTE) */}
        <Route element={<ProtectedRoute allowedRoles={['CLIENTE']} />}>
          <Route
            path="/compras"
            element={
              <section style={{ padding: '2rem' }}>
                <h1>Mis Compras</h1>
                <p>Historial y seguimiento de pedidos del cliente.</p>
              </section>
            }
          />
        </Route>

        {/* Rutas exclusivas de personal de cafetería (CAJERO) */}
        <Route element={<ProtectedRoute allowedRoles={['CAJERO']} />}>
          <Route
            path="/cajero"
            element={
              <section style={{ padding: '2rem' }}>
                <h1>Panel de Cajero</h1>
                <p>Gestión de pedidos y validación de retiro en cafetería.</p>
              </section>
            }
          />
        </Route>

        {/* Pagina 404 para rutas inexistentes */}
        <Route path="*" element={<NotFoundPage />} />

      </Route>
    </Routes>
  );
}
