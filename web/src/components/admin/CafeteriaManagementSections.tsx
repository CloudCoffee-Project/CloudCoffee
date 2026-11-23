import { type FormEvent, useEffect, useState } from 'react';
import {
  type CafeteriaAdminItem,
  type CafeteriaOperationalStatus,
  type CampusAdminItem,
  type SpringPage,
  changeCafeteriaOperationalStatus,
  createAdminCafeteria,
  createAdminIdempotencyKey,
  deactivateAdminCafeteria,
  formatCafeteriaAdminError,
  formatOperationalStatus,
  getAssignedCafeteria,
  listAdminCafeterias,
  listAdminCampuses,
  OPERATIONAL_STATUS_LABELS,
  reactivateAdminCafeteria,
  updateAdminCafeteria,
  validateCafeteriaName,
} from '../../services/cafeteriaAdmin';
import { ApiRequestError } from '../../services/httpClient';
import { ErrorState } from '../common/ErrorState';
import { LoadingSpinner } from '../common/LoadingSpinner';

type LoadListState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; pageData: SpringPage<CafeteriaAdminItem>; campuses: CampusAdminItem[] };

type AssignedCafeteriaState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; cafeteria: CafeteriaAdminItem };

const OPERATIONAL_STATUS_OPTIONS = Object.entries(OPERATIONAL_STATUS_LABELS) as Array<
  [CafeteriaOperationalStatus, string]
>;

export function SuperAdminCafeteriasSection() {
  const [campusFilter, setCampusFilter] = useState<string>('');
  const [activoFilter, setActivoFilter] = useState<'all' | 'true' | 'false'>('all');
  const [page, setPage] = useState<number>(0);
  const [reloadTick, setReloadTick] = useState<number>(0);
  const [listState, setListState] = useState<LoadListState>({ status: 'loading' });

  // Estado formulario creación
  const [createCampusId, setCreateCampusId] = useState<string>('');
  const [createNombre, setCreateNombre] = useState<string>('');
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState<string>(() =>
    createAdminIdempotencyKey(),
  );

  // Estado edición en línea
  const [editingCafeteria, setEditingCafeteria] = useState<CafeteriaAdminItem | null>(null);
  const [editNombre, setEditNombre] = useState<string>('');

  // Estado confirmación de baja lógica
  const [confirmingDeactivation, setConfirmingDeactivation] = useState<CafeteriaAdminItem | null>(
    null,
  );

  // Mensajes y bloqueo de doble envío
  const [formError, setFormError] = useState<string>('');
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    const controller = new AbortController();
    setListState((prev) =>
      prev.status === 'success' && reloadTick > 0 ? prev : { status: 'loading' },
    );

    const parsedActivo =
      activoFilter === 'all' ? undefined : activoFilter === 'true';

    Promise.all([
      listAdminCampuses(undefined, controller.signal),
      listAdminCafeterias(
        {
          campusId: campusFilter || undefined,
          activo: parsedActivo,
          page,
          size: 20,
        },
        controller.signal,
      ),
    ])
      .then(([campusesPage, cafeteriasPage]) => {
        if (controller.signal.aborted) return;
        const campuses = campusesPage.content ?? [];
        setListState({
          status: 'success',
          pageData: cafeteriasPage,
          campuses,
        });
        setCreateCampusId((current) => {
          if (current && campuses.some((c) => c.campusId === current && c.activo)) {
            return current;
          }
          return campuses.find((c) => c.activo)?.campusId ?? '';
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setListState({
          status: 'error',
          message: formatCafeteriaAdminError(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [campusFilter, activoFilter, page, reloadTick]);

  function refreshFromServer() {
    setReloadTick((tick) => tick + 1);
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError('');
    setFeedbackMessage('');

    if (!createCampusId.trim()) {
      setFormError('Debes seleccionar un campus activo para la cafetería.');
      return;
    }

    const nameError = validateCafeteriaName(createNombre);
    if (nameError) {
      setFormError(nameError);
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createAdminCafeteria(
        { campusId: createCampusId, nombre: createNombre },
        createIdempotencyKey,
      );
      setCreateNombre('');
      setCreateIdempotencyKey(createAdminIdempotencyKey());
      setFeedbackMessage(
        `Cafetería "${created.nombre}" creada correctamente (estado inicial: ${formatOperationalStatus(created.estadoOperativo)}).`,
      );
      refreshFromServer();
    } catch (error: unknown) {
      if (
        !(error instanceof ApiRequestError) ||
        (error.status !== null && error.status !== 503 && error.code !== 'OPERACION_PENDIENTE')
      ) {
        setCreateIdempotencyKey(createAdminIdempotencyKey());
      }
      setFormError(formatCafeteriaAdminError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(cafeteria: CafeteriaAdminItem) {
    setEditingCafeteria(cafeteria);
    setEditNombre(cafeteria.nombre);
    setConfirmingDeactivation(null);
    setFormError('');
    setFeedbackMessage('');
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCafeteria || isSubmitting) return;

    setFormError('');
    setFeedbackMessage('');

    const nameError = validateCafeteriaName(editNombre);
    if (nameError) {
      setFormError(nameError);
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateAdminCafeteria(editingCafeteria.cafeteriaId, {
        nombre: editNombre,
        version: editingCafeteria.version,
      });
      setEditingCafeteria(null);
      setEditNombre('');
      setFeedbackMessage(`Cafetería "${updated.nombre}" actualizada a la versión ${updated.version}.`);
      refreshFromServer();
    } catch (error: unknown) {
      setFormError(formatCafeteriaAdminError(error));
      if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICTO') {
        setEditingCafeteria(null);
        refreshFromServer();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDeactivate() {
    if (!confirmingDeactivation || isSubmitting) return;

    setIsSubmitting(true);
    setFormError('');
    setFeedbackMessage('');
    try {
      const updated = await deactivateAdminCafeteria(confirmingDeactivation.cafeteriaId);
      setConfirmingDeactivation(null);
      setFeedbackMessage(
        `La cafetería "${updated.nombre}" fue dada de baja lógica. Ya no recibirá nuevas compras en el catálogo público.`,
      );
      refreshFromServer();
    } catch (error: unknown) {
      setFormError(formatCafeteriaAdminError(error));
      refreshFromServer();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReactivate(cafeteria: CafeteriaAdminItem) {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFormError('');
    setFeedbackMessage('');
    try {
      const updated = await reactivateAdminCafeteria(cafeteria.cafeteriaId);
      setFeedbackMessage(`La cafetería "${updated.nombre}" fue reactivada correctamente.`);
      refreshFromServer();
    } catch (error: unknown) {
      setFormError(formatCafeteriaAdminError(error));
      refreshFromServer();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (listState.status === 'loading') {
    return (
      <div role="status" className="admin-panel-notice">
        <LoadingSpinner />
        <p>Cargando cafeterías y campus…</p>
      </div>
    );
  }

  if (listState.status === 'error') {
    return (
      <div role="alert" className="admin-panel-notice">
        <ErrorState message={listState.message} />
        <button type="button" className="btn-primary" onClick={refreshFromServer}>
          Reintentar carga
        </button>
      </div>
    );
  }

  const { pageData, campuses } = listState;
  const campusNameById = new Map(campuses.map((campus) => [campus.campusId, campus.nombre]));
  const activeCampuses = campuses.filter((campus) => campus.activo);

  return (
    <div className="admin-cafeterias-section">
      {feedbackMessage && (
        <p role="status" className="admin-feedback-success">
          {feedbackMessage}
        </p>
      )}
      {formError && (
        <p role="alert" className="admin-feedback-error">
          {formError}
        </p>
      )}

      <section className="admin-panel-notice" aria-labelledby="create-cafeteria-heading">
        <h2 id="create-cafeteria-heading">Crear nueva cafetería</h2>
        <p>
          Toda cafetería nueva se registra activa y en estado operativo <strong>Cerrada</strong> hasta
          que su administrador de cafetería habilite la apertura.
        </p>
        <form className="admin-form-grid" onSubmit={(e) => void handleCreateSubmit(e)} noValidate>
          <label>
            Campus de la cafetería
            <select
              value={createCampusId}
              disabled={isSubmitting || activeCampuses.length === 0}
              onChange={(event) => setCreateCampusId(event.target.value)}
            >
              <option value="">Selecciona un campus</option>
              {activeCampuses.map((campus) => (
                <option key={campus.campusId} value={campus.campusId}>
                  {campus.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nombre de la cafetería
            <input
              type="text"
              maxLength={150}
              placeholder="Ej. Cafetería Biblioteca"
              value={createNombre}
              disabled={isSubmitting}
              onChange={(event) => setCreateNombre(event.target.value)}
            />
          </label>
          <div className="admin-form-actions">
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando…' : 'Crear cafetería'}
            </button>
          </div>
        </form>
      </section>

      {editingCafeteria && (
        <section className="admin-panel-notice" aria-labelledby="edit-cafeteria-heading">
          <h2 id="edit-cafeteria-heading">Editar cafetería: {editingCafeteria.nombre}</h2>
          <form className="admin-form-grid" onSubmit={(e) => void handleEditSubmit(e)} noValidate>
            <label>
              Nuevo nombre para la cafetería
              <input
                type="text"
                maxLength={150}
                value={editNombre}
                disabled={isSubmitting}
                onChange={(event) => setEditNombre(event.target.value)}
              />
            </label>
            <div className="admin-form-actions">
              <button type="submit" className="btn-primary" disabled={isSubmitting}>
                {isSubmitting ? 'Actualizando…' : 'Guardar cambios'}
              </button>
              <button
                type="button"
                className="admin-btn-secondary"
                disabled={isSubmitting}
                onClick={() => setEditingCafeteria(null)}
              >
                Cancelar edición
              </button>
            </div>
          </form>
        </section>
      )}

      {confirmingDeactivation && (
        <section
          role="alertdialog"
          aria-labelledby="confirm-baja-heading"
          className="admin-panel-notice admin-confirm-box"
        >
          <h2 id="confirm-baja-heading">
            Confirmar baja lógica de {confirmingDeactivation.nombre}
          </h2>
          <p>
            Al dar de baja esta cafetería dejará de vender en el catálogo público. Las reservas
            vigentes y órdenes ya pagadas conservarán su historial y ciclo de retiro.
          </p>
          <div className="admin-form-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={isSubmitting}
              onClick={() => void handleConfirmDeactivate()}
            >
              {isSubmitting ? 'Procesando baja…' : 'Confirmar baja de cafetería'}
            </button>
            <button
              type="button"
              className="admin-btn-secondary"
              disabled={isSubmitting}
              onClick={() => setConfirmingDeactivation(null)}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}

      <section className="admin-panel-notice" aria-labelledby="list-cafeterias-heading">
        <div className="admin-list-header">
          <h2 id="list-cafeterias-heading">Listado de cafeterías</h2>
          <div className="admin-filters-bar">
            <label>
              Filtrar por campus
              <select
                value={campusFilter}
                onChange={(event) => {
                  setCampusFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">Todos los campus</option>
                {campuses.map((campus) => (
                  <option key={campus.campusId} value={campus.campusId}>
                    {campus.nombre} {!campus.activo ? '(Inactivo)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Filtrar por vigencia
              <select
                value={activoFilter}
                onChange={(event) => {
                  setActivoFilter(event.target.value as 'all' | 'true' | 'false');
                  setPage(0);
                }}
              >
                <option value="all">Todas</option>
                <option value="true">Solo activas</option>
                <option value="false">Dadas de baja</option>
              </select>
            </label>
          </div>
        </div>

        {pageData.content.length === 0 ? (
          <p role="status">No se encontraron cafeterías para los filtros seleccionados.</p>
        ) : (
          <>
            <ul className="admin-cafeterias-list">
              {pageData.content.map((cafeteria) => (
                <li key={cafeteria.cafeteriaId} className="admin-cafeteria-row">
                  <div>
                    <h3>{cafeteria.nombre}</h3>
                    <p>
                      Campus: <strong>{campusNameById.get(cafeteria.campusId) ?? cafeteria.campusId}</strong>
                      {' · '}
                      Vigencia: <strong>{cafeteria.activa ? 'Activa' : 'Dada de baja'}</strong>
                      {' · '}
                      Estado operativo (administrado por cafetería):{' '}
                      <strong>{formatOperationalStatus(cafeteria.estadoOperativo)}</strong>
                      {' · '}
                      Versión: {cafeteria.version}
                    </p>
                  </div>
                  <div className="admin-form-actions">
                    <button
                      type="button"
                      className="admin-btn-secondary"
                      disabled={isSubmitting}
                      onClick={() => startEdit(cafeteria)}
                    >
                      Editar nombre
                    </button>
                    {cafeteria.activa ? (
                      <button
                        type="button"
                        className="admin-btn-danger"
                        disabled={isSubmitting}
                        onClick={() => {
                          setConfirmingDeactivation(cafeteria);
                          setEditingCafeteria(null);
                          setFormError('');
                        }}
                      >
                        Dar de baja
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={isSubmitting}
                        onClick={() => void handleReactivate(cafeteria)}
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {pageData.totalPages > 1 && (
              <nav className="admin-pagination" aria-label="Paginación de cafeterías">
                <button
                  type="button"
                  className="admin-btn-secondary"
                  disabled={pageData.first || isSubmitting}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Anterior
                </button>
                <span>
                  Página {pageData.number + 1} de {pageData.totalPages}
                </span>
                <button
                  type="button"
                  className="admin-btn-secondary"
                  disabled={pageData.last || isSubmitting}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export function AdminCafeteriaOperationalSection({ cafeteriaId }: { cafeteriaId: string }) {
  const [state, setState] = useState<AssignedCafeteriaState>({ status: 'loading' });
  const [selectedStatus, setSelectedStatus] = useState<CafeteriaOperationalStatus>('OPEN');
  const [reloadTick, setReloadTick] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) =>
      prev.status === 'success' && reloadTick > 0 ? prev : { status: 'loading' },
    );

    getAssignedCafeteria(cafeteriaId, controller.signal)
      .then((cafeteria) => {
        if (controller.signal.aborted) return;
        setState({ status: 'success', cafeteria });
        setSelectedStatus(cafeteria.estadoOperativo);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: formatCafeteriaAdminError(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [cafeteriaId, reloadTick]);

  function refreshCafeteria() {
    setReloadTick((tick) => tick + 1);
  }

  async function handleStatusSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== 'success' || isSubmitting) return;

    setErrorMessage('');
    setFeedbackMessage('');
    setIsSubmitting(true);

    try {
      const updated = await changeCafeteriaOperationalStatus(cafeteriaId, {
        estadoOperativo: selectedStatus,
        version: state.cafeteria.version,
      });
      setState({ status: 'success', cafeteria: updated });
      setSelectedStatus(updated.estadoOperativo);
      setFeedbackMessage(
        `Estado operativo actualizado a "${formatOperationalStatus(updated.estadoOperativo)}" (versión ${updated.version}).`,
      );
    } catch (error: unknown) {
      setErrorMessage(formatCafeteriaAdminError(error));
      if (
        error instanceof ApiRequestError &&
        (error.code === 'VERSION_CONFLICTO' || error.code === 'CAFETERIA_DADA_DE_BAJA')
      ) {
        refreshCafeteria();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div role="status" className="admin-panel-notice">
        <LoadingSpinner />
        <p>Consultando parámetros operativos de tu cafetería…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" className="admin-panel-notice">
        <ErrorState message={state.message} />
        <button type="button" className="btn-primary" onClick={refreshCafeteria}>
          Reintentar consulta
        </button>
      </div>
    );
  }

  const { cafeteria } = state;

  return (
    <section className="admin-panel-notice" aria-labelledby="operational-config-heading">
      <h2 id="operational-config-heading">Parámetros operativos de {cafeteria.nombre}</h2>
      <p>
        Estado operativo actual: <strong>{formatOperationalStatus(cafeteria.estadoOperativo)}</strong>
        {' · '}
        Vigencia en plataforma: <strong>{cafeteria.activa ? 'Activa' : 'Dada de baja'}</strong>
        {' · '}
        Versión: {cafeteria.version}
      </p>
      <p>
        El cierre operativo (<strong>Cerrada</strong> o <strong>En mantenimiento</strong>) pausa
        temporalmente nuevas ventas en el catálogo público sin dar de baja la cafetería ni cancelar
        pedidos ya pagados.
      </p>

      {feedbackMessage && (
        <p role="status" className="admin-feedback-success">
          {feedbackMessage}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="admin-feedback-error">
          {errorMessage}
        </p>
      )}

      {!cafeteria.activa ? (
        <div role="alert" className="admin-confirm-box">
          <p>
            Esta cafetería fue dada de baja por un superadministrador. No es posible modificar su
            estado operativo mientras permanezca dada de baja.
          </p>
        </div>
      ) : (
        <form className="admin-form-grid" onSubmit={(e) => void handleStatusSubmit(e)}>
          <label>
            Estado operativo de la cafetería
            <select
              value={selectedStatus}
              disabled={isSubmitting}
              onChange={(event) =>
                setSelectedStatus(event.target.value as CafeteriaOperationalStatus)
              }
            >
              {OPERATIONAL_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-form-actions">
            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Guardando estado…' : 'Actualizar estado operativo'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}