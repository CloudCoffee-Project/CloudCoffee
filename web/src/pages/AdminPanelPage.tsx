import { CafeteriaSalesSection } from '../components/admin/CafeteriaSalesSection';
import {
  AdminCafeteriaOperationalSection,
  SuperAdminCafeteriasSection,
} from '../components/admin/CafeteriaManagementSections';
import { ProductImageManager } from '../components/ProductImageManager';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';
import {
  type AdminSectionKey,
  type VerifiedAdminContext,
  verifyAdminContext,
} from '../services/adminAccess';
import { ApiRequestError } from '../services/httpClient';
import './AdminPanelPage.css';

interface AdminPanelPageProps {
  panelRole: 'ADMIN_CAFETERIA' | 'SUPER_ADMIN';
  section: AdminSectionKey;
}

type AdminLoadState =
  | { status: 'loading' }
  | { status: 'unassigned' }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; context: VerifiedAdminContext };

export function AdminPanelPage({ panelRole, section }: AdminPanelPageProps) {
  const { userId, role, cafeteriaId } = useAuth();
  const [state, setState] = useState<AdminLoadState>({ status: 'loading' });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    // Limpiar inmediatamente cualquier dato previo ante cambio de usuario, rol o asignación
    if (panelRole === 'ADMIN_CAFETERIA' && (!cafeteriaId || !cafeteriaId.trim())) {
      setState({ status: 'unassigned' });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });

    verifyAdminContext(panelRole, cafeteriaId, controller.signal)
      .then((verifiedContext) => {
        if (controller.signal.aborted) return;
        if (panelRole === 'ADMIN_CAFETERIA' && !verifiedContext.cafeteriaId) {
          setState({ status: 'unassigned' });
          return;
        }
        setState({ status: 'ready', context: verifiedContext });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.status === 403) {
          setState({
            status: 'forbidden',
            message:
              error.detail ||
              'Tu asignación o permisos para esta cafetería ya no se encuentran vigentes.',
          });
          return;
        }
        setState({
          status: 'error',
          message:
            error instanceof ApiRequestError
              ? error.detail
              : 'No fue posible verificar los permisos administrativos con el servidor.',
        });
      });

    return () => {
      controller.abort();
    };
  }, [panelRole, userId, role, cafeteriaId, retryCount]);

  const panelTitle =
    panelRole === 'SUPER_ADMIN'
      ? 'Panel de Superadministración'
      : 'Panel de Administración de Cafetería';

  const basePath = panelRole === 'SUPER_ADMIN' ? '/superadmin' : '/admin';

  if (state.status === 'loading') {
    return (
      <section className="admin-panel" aria-labelledby="admin-panel-title" aria-busy="true">
        <h1 id="admin-panel-title">{panelTitle}</h1>
        <div role="status">
          <LoadingSpinner />
          <p>Verificando permisos y asignación con el servidor…</p>
        </div>
      </section>
    );
  }

  if (state.status === 'unassigned') {
    return (
      <section className="admin-panel" aria-labelledby="admin-panel-title">
        <header className="admin-panel-header">
          <div>
            <h1 id="admin-panel-title">{panelTitle}</h1>
            <p>Gestión operativa de cafetería.</p>
          </div>
          <span className="admin-panel-badge">Sin cafetería asignada</span>
        </header>
        <div className="admin-panel-notice" role="status">
          <h2>Personal sin cafetería asignada</h2>
          <p>
            Tu cuenta de administrador no tiene una cafetería asignada en el servidor. No hay
            acciones operativas habilitadas hasta que un superadministrador registre tu asignación.
          </p>
        </div>
      </section>
    );
  }

  if (state.status === 'forbidden') {
    return (
      <section className="admin-panel" aria-labelledby="admin-panel-title">
        <header className="admin-panel-header">
          <div>
            <h1 id="admin-panel-title">{panelTitle}</h1>
          </div>
          <span className="admin-panel-badge">Acceso revocado (403)</span>
        </header>
        <div className="admin-panel-notice" role="alert">
          <h2>Asignación o permiso no autorizado</h2>
          <p>{state.message}</p>
          <p>
            Se ocultaron los datos y las acciones operativas de la cafetería anterior.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Revalidar asignación
          </button>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="admin-panel" aria-labelledby="admin-panel-title">
        <header className="admin-panel-header">
          <h1 id="admin-panel-title">{panelTitle}</h1>
        </header>
        <div role="alert">
          <ErrorState message={state.message} />
          <button
            type="button"
            className="btn-primary"
            onClick={() => setRetryCount((count) => count + 1)}
          >
            Reintentar verificación
          </button>
        </div>
      </section>
    );
  }

  const { context } = state;
  const activeItem = context.permissions.find((item) => item.key === section) ?? null;

  return (
    <section className="admin-panel" aria-labelledby="admin-panel-title">
      <header className="admin-panel-header">
        <div>
          <h1 id="admin-panel-title">{panelTitle}</h1>
          <p>
            Sesión verificada: <strong>{context.profile.email}</strong>
          </p>
        </div>
        <div>
          {panelRole === 'ADMIN_CAFETERIA' && context.cafeteriaId ? (
            <span className="admin-panel-badge">
              Cafetería asignada: {context.cafeteriaId}
              {context.inventoryCount !== null ? ` · ${context.inventoryCount} ofertas` : ''}
            </span>
          ) : (
            <span className="admin-panel-badge">Alcance: Plataforma global</span>
          )}
        </div>
      </header>

      <nav className="admin-panel-nav" aria-label="Secciones de administración">
        <NavLink
          to={basePath}
          end
          className={({ isActive }) => `admin-panel-nav-link${isActive ? ' active' : ''}`}
        >
          Resumen
        </NavLink>
        {context.permissions.map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) => `admin-panel-nav-link${isActive ? ' active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {activeItem ? (
        panelRole === 'SUPER_ADMIN' && section === 'cafeterias' ? (
          <SuperAdminCafeteriasSection />
        ) : panelRole === 'ADMIN_CAFETERIA' && section === 'cafeteria' && context.cafeteriaId ? (
          <AdminCafeteriaOperationalSection cafeteriaId={context.cafeteriaId} />
        ) : panelRole === 'ADMIN_CAFETERIA' && section === 'ventas' && context.cafeteriaId ? (
          <CafeteriaSalesSection />
        ) : (
          <section className="admin-panel-notice" aria-labelledby="admin-section-heading">
            <h2 id="admin-section-heading">{activeItem.label}</h2>
            <p>{activeItem.description}</p>
            {panelRole === 'SUPER_ADMIN' && section === 'catalogo' && <ProductImageManager key={userId} />}
            <p>
              Módulo habilitado para <strong>{panelRole}</strong>
              {context.cafeteriaId ? ` en cafetería ${context.cafeteriaId}` : ' a nivel global'}.
            </p>
          </section>
        )
      ) : (
        <div className="admin-panel-grid" role="region" aria-label="Módulos administrativos disponibles">
          {context.permissions.map((item) => (
            <article key={item.key} className="admin-panel-card">
              <div>
                <h2>{item.label}</h2>
                <p>{item.description}</p>
              </div>
              <Link to={item.path} className="btn-primary" style={{ textDecoration: 'none', textAlign: 'center' }}>
                {item.operationalActionLabel}
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
