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
import { PasswordChangePage } from './pages/PasswordChangePage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { PaymentResultPage } from './pages/PaymentResultPage';
import { CashierOrdersPage } from './pages/CashierOrdersPage';
import { AdminPanelPage } from './pages/AdminPanelPage';


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
        <Route path="/restaurar-contrasena" element={<PasswordResetPage />} />

        {/* Rutas privadas para cualquier usuario con sesión */}
        <Route element={<ProtectedRoute />}>
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/perfil/cambiar-contrasena" element={<PasswordChangePage />} />
        </Route>

        {/* Rutas exclusivas de comprador (CLIENTE) */}
        <Route element={<ProtectedRoute allowedRoles={['CLIENTE']} />}>
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/pago/resultado" element={<PaymentResultPage />} />
          <Route path="/pago/retorno" element={<PaymentResultPage />} />
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
          <Route path="/cajero" element={<CashierOrdersPage />} />
        </Route>
        {/* Rutas exclusivas de administrador de cafetería (ADMIN_CAFETERIA) */}
        <Route element={<ProtectedRoute allowedRoles={['ADMIN_CAFETERIA']} />}>
          <Route path="/admin" element={<AdminPanelPage panelRole="ADMIN_CAFETERIA" section="resumen" />} />
          <Route path="/admin/cafeteria" element={<AdminPanelPage panelRole="ADMIN_CAFETERIA" section="cafeteria" />} />
          <Route path="/admin/personal" element={<AdminPanelPage panelRole="ADMIN_CAFETERIA" section="personal" />} />
          <Route path="/admin/ofertas" element={<AdminPanelPage panelRole="ADMIN_CAFETERIA" section="ofertas" />} />
          <Route path="/admin/inventario" element={<AdminPanelPage panelRole="ADMIN_CAFETERIA" section="inventario" />} />
          <Route path="/admin/ventas" element={<AdminPanelPage panelRole="ADMIN_CAFETERIA" section="ventas" />} />
        </Route>

        {/* Rutas exclusivas de superadministrador (SUPER_ADMIN) */}
        <Route element={<ProtectedRoute allowedRoles={['SUPER_ADMIN']} />}>
          <Route path="/superadmin" element={<AdminPanelPage panelRole="SUPER_ADMIN" section="resumen" />} />
          <Route path="/superadmin/cafeterias" element={<AdminPanelPage panelRole="SUPER_ADMIN" section="cafeterias" />} />
          <Route path="/superadmin/usuarios" element={<AdminPanelPage panelRole="SUPER_ADMIN" section="usuarios" />} />
          <Route path="/superadmin/catalogo" element={<AdminPanelPage panelRole="SUPER_ADMIN" section="catalogo" />} />
          <Route path="/superadmin/ventas" element={<AdminPanelPage panelRole="SUPER_ADMIN" section="ventas" />} />
        </Route>

        {/* Pagina 404 para rutas inexistentes */}
        <Route path="*" element={<NotFoundPage />} />

      </Route>
    </Routes>
  );
}
