import { type FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  describeSaleStatus,
  formatClpAmount,
  formatSalesError,
  formatSantiagoDateTime,
  getCafeteriaSaleDetail,
  getCafeteriaSales,
  getCafeteriaSalesSummary,
  getDefaultSalesDateRange,
  SALE_STATUS_OPTIONS,
  type SaleDetail,
  type SalesPage,
  type SalesSummary,
  validateSalesDateRange,
} from '../../services/cafeteriaSales';
import { ErrorState } from '../common/ErrorState';
import { LoadingSpinner } from '../common/LoadingSpinner';

type SalesBoardState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; summary: SalesSummary; pageData: SalesPage };

type SaleDetailState =
  | { status: 'idle' }
  | { status: 'loading'; ordenId: string }
  | { status: 'error'; ordenId: string; message: string }
  | { status: 'success'; detail: SaleDetail };

export function CafeteriaSalesSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultRange = getDefaultSalesDateRange();

  const appliedDesde = searchParams.get('desde') ?? defaultRange.desde;
  const appliedHasta = searchParams.get('hasta') ?? defaultRange.hasta;
  const appliedEstado = searchParams.get('estado') ?? '';
  const parsedPage = Number.parseInt(searchParams.get('page') ?? '0', 10);
  const appliedPage = Number.isNaN(parsedPage) || parsedPage < 0 ? 0 : parsedPage;

  const [desdeInput, setDesdeInput] = useState<string>(appliedDesde);
  const [hastaInput, setHastaInput] = useState<string>(appliedHasta);
  const [estadoInput, setEstadoInput] = useState<string>(appliedEstado);
  const [validationError, setValidationError] = useState<string>('');
  const [reloadTick, setReloadTick] = useState<number>(0);

  const [boardState, setBoardState] = useState<SalesBoardState>({ status: 'loading' });
  const [detailState, setDetailState] = useState<SaleDetailState>({ status: 'idle' });
  const [detailRetryTick, setDetailRetryTick] = useState<number>(0);

  useEffect(() => {
    setDesdeInput(appliedDesde);
    setHastaInput(appliedHasta);
    setEstadoInput(appliedEstado);
  }, [appliedDesde, appliedHasta, appliedEstado]);

  useEffect(() => {
    const rangeError = validateSalesDateRange(appliedDesde, appliedHasta);
    if (rangeError) {
      setValidationError(rangeError);
      return;
    }

    setValidationError('');
    const controller = new AbortController();
    setBoardState({ status: 'loading' });

    Promise.all([
      getCafeteriaSalesSummary(
        {
          desde: appliedDesde,
          hasta: appliedHasta,
          estado: appliedEstado || undefined,
        },
        controller.signal,
      ),
      getCafeteriaSales(
        {
          desde: appliedDesde,
          hasta: appliedHasta,
          estado: appliedEstado || undefined,
          page: appliedPage,
          size: 20,
        },
        controller.signal,
      ),
    ])
      .then(([summary, pageData]) => {
        if (controller.signal.aborted) return;
        setBoardState({ status: 'success', summary, pageData });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBoardState({
          status: 'error',
          message: formatSalesError(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [appliedDesde, appliedHasta, appliedEstado, appliedPage, reloadTick]);

  const selectedOrdenId =
    detailState.status === 'loading' || detailState.status === 'error'
      ? detailState.ordenId
      : detailState.status === 'success'
        ? detailState.detail.venta.ordenId
        : null;

  useEffect(() => {
    if (!selectedOrdenId || detailState.status !== 'loading') return;

    const controller = new AbortController();
    getCafeteriaSaleDetail(selectedOrdenId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setDetailState({ status: 'success', detail });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setDetailState({
          status: 'error',
          ordenId: selectedOrdenId,
          message: formatSalesError(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [selectedOrdenId, detailState.status, detailRetryTick]);

  function applyFiltersToUrl(next: {
    desde: string;
    hasta: string;
    estado: string;
    page: number;
  }) {
    const params = new URLSearchParams();
    if (next.desde) params.set('desde', next.desde);
    if (next.hasta) params.set('hasta', next.hasta);
    if (next.estado) params.set('estado', next.estado);
    if (next.page > 0) params.set('page', String(next.page));
    setSearchParams(params, { replace: true });
  }

  function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rangeError = validateSalesDateRange(desdeInput, hastaInput);
    if (rangeError) {
      setValidationError(rangeError);
      return;
    }

    setValidationError('');
    setDetailState({ status: 'idle' });
    applyFiltersToUrl({
      desde: desdeInput.trim(),
      hasta: hastaInput.trim(),
      estado: estadoInput.trim(),
      page: 0,
    });
  }

  function handleResetFilters() {
    const freshRange = getDefaultSalesDateRange();
    setDesdeInput(freshRange.desde);
    setHastaInput(freshRange.hasta);
    setEstadoInput('');
    setValidationError('');
    setDetailState({ status: 'idle' });
    applyFiltersToUrl({
      desde: freshRange.desde,
      hasta: freshRange.hasta,
      estado: '',
      page: 0,
    });
  }

  function handlePageChange(nextPage: number) {
    setDetailState({ status: 'idle' });
    applyFiltersToUrl({
      desde: appliedDesde,
      hasta: appliedHasta,
      estado: appliedEstado,
      page: Math.max(0, nextPage),
    });
  }

  function openOrderDetail(ordenId: string) {
    setDetailState({ status: 'loading', ordenId });
  }

  return (
    <div className="admin-sales-section">
      <section className="admin-panel-notice" aria-labelledby="sales-filters-heading">
        <h2 id="sales-filters-heading">Filtros de ventas de tu cafetería</h2>
        <p>
          Las fechas se evalúan en horario <strong>America/Santiago</strong> (máximo 92 días
          inclusivos). Solo se incluyen órdenes con pago aprobado de tu cafetería asignada; las
          órdenes <strong>canceladas</strong> o impagas quedan excluidas del cómputo de ventas, y en
          compras multi-cafetería únicamente figura el importe histórico correspondiente a tu
          cafetería.
        </p>

        <form className="admin-form-grid" onSubmit={handleFilterSubmit} noValidate>
          <label>
            Desde (fecha de pago)
            <input
              type="date"
              value={desdeInput}
              onChange={(event) => setDesdeInput(event.target.value)}
            />
          </label>
          <label>
            Hasta (fecha de pago)
            <input
              type="date"
              value={hastaInput}
              onChange={(event) => setHastaInput(event.target.value)}
            />
          </label>
          <label>
            Estado de la orden
            <select
              value={estadoInput}
              onChange={(event) => setEstadoInput(event.target.value)}
            >
              <option value="">Todos los estados de venta</option>
              {SALE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-form-actions">
            <button type="submit" className="btn-primary">
              Aplicar filtros
            </button>
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={handleResetFilters}
            >
              Restablecer
            </button>
          </div>
        </form>

        {validationError && (
          <p role="alert" className="admin-feedback-error" style={{ marginTop: '1rem' }}>
            {validationError}
          </p>
        )}
      </section>

      {boardState.status === 'loading' && (
        <div role="status" className="admin-panel-notice">
          <LoadingSpinner />
          <p>Consultando resumen e historial de ventas con el servidor…</p>
        </div>
      )}

      {boardState.status === 'error' && (
        <div role="alert" className="admin-panel-notice">
          <ErrorState message={boardState.message} />
          <button
            type="button"
            className="btn-primary"
            onClick={() => setReloadTick((tick) => tick + 1)}
          >
            Reintentar consulta
          </button>
        </div>
      )}

      {boardState.status === 'success' && (
        <>
          <section className="admin-panel-notice" aria-labelledby="sales-summary-heading">
            <h2 id="sales-summary-heading">
              Resumen del periodo ({boardState.summary.desde} a {boardState.summary.hasta})
            </h2>
            <div className="admin-sales-kpis">
              <article className="admin-sales-kpi-card">
                <span>Órdenes pagadas autorizadas</span>
                <strong>{boardState.summary.ordenes}</strong>
              </article>
              <article className="admin-sales-kpi-card">
                <span>Monto total de tu cafetería</span>
                <strong>{formatClpAmount(boardState.summary.montoTotal)}</strong>
              </article>
            </div>

            {boardState.summary.porEstado.length > 0 && (
              <div className="admin-sales-breakdown">
                <h3>Desglose por estado</h3>
                <ul className="admin-sales-breakdown-list">
                  {boardState.summary.porEstado.map((entry) => {
                    const meta = describeSaleStatus(entry.estado);
                    return (
                      <li key={entry.estado} className="admin-sales-breakdown-item">
                        <span className={`admin-sale-status admin-sale-status-${meta.category}`}>
                          {meta.label}
                        </span>
                        <span>{entry.ordenes} {entry.ordenes === 1 ? 'orden' : 'órdenes'}</span>
                        <strong>{formatClpAmount(entry.montoTotal)}</strong>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          {detailState.status !== 'idle' && (
            <section className="admin-panel-notice" aria-labelledby="sale-detail-heading">
              <div className="admin-list-header">
                <h2 id="sale-detail-heading">Detalle histórico de la orden</h2>
                <button
                  type="button"
                  className="admin-btn-secondary"
                  onClick={() => setDetailState({ status: 'idle' })}
                >
                  Cerrar detalle
                </button>
              </div>

              {detailState.status === 'loading' && (
                <div role="status">
                  <LoadingSpinner />
                  <p>Cargando detalle de la venta…</p>
                </div>
              )}

              {detailState.status === 'error' && (
                <div role="alert">
                  <ErrorState message={detailState.message} />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setDetailRetryTick((tick) => tick + 1)}
                  >
                    Reintentar detalle
                  </button>
                </div>
              )}

              {detailState.status === 'success' && (
                <div>
                  <p>
                    Código: <strong>{detailState.detail.venta.codigoOrden}</strong>
                    {' · '}
                    Estado:{' '}
                    <span
                      className={`admin-sale-status admin-sale-status-${describeSaleStatus(detailState.detail.venta.estado).category}`}
                    >
                      {describeSaleStatus(detailState.detail.venta.estado).label}
                    </span>
                    {' · '}
                    Pago (America/Santiago):{' '}
                    <strong>{formatSantiagoDateTime(detailState.detail.venta.pagadoAt)}</strong>
                    {' · '}
                    Entrega (America/Santiago):{' '}
                    <strong>{formatSantiagoDateTime(detailState.detail.venta.entregadoAt)}</strong>
                  </p>

                  <table className="admin-sales-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Cantidad</th>
                        <th>Precio histórico unitario</th>
                        <th>Subtotal histórico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailState.detail.items.map((item) => (
                        <tr key={item.ordenItemId}>
                          <td>{item.productoNombre}</td>
                          <td>{item.cantidad}</td>
                          <td>{formatClpAmount(item.precioUnitario)}</td>
                          <td>{formatClpAmount(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p className="admin-sales-detail-total">
                    Total histórico de la orden:{' '}
                    <strong>{formatClpAmount(detailState.detail.venta.montoTotal)}</strong>
                  </p>
                </div>
              )}
            </section>
          )}

          <section className="admin-panel-notice" aria-labelledby="sales-history-heading">
            <h2 id="sales-history-heading">Historial de órdenes vendidas</h2>

            {boardState.pageData.content.length === 0 ? (
              <p role="status">
                No se registraron ventas para tu cafetería en el rango y estado seleccionados.
              </p>
            ) : (
              <>
                <div className="admin-sales-table-wrapper">
                  <table className="admin-sales-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Estado</th>
                        <th>Líneas de ítems</th>
                        <th>Fecha de pago (Santiago)</th>
                        <th>Fecha de entrega (Santiago)</th>
                        <th>Monto orden</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boardState.pageData.content.map((sale) => {
                        const statusMeta = describeSaleStatus(sale.estado);
                        return (
                          <tr key={sale.ordenId}>
                            <td>
                              <strong>{sale.codigoOrden}</strong>
                            </td>
                            <td>
                              <span
                                className={`admin-sale-status admin-sale-status-${statusMeta.category}`}
                              >
                                {statusMeta.label}
                              </span>
                            </td>
                            <td>{sale.cantidadItems}</td>
                            <td>{formatSantiagoDateTime(sale.pagadoAt)}</td>
                            <td>{formatSantiagoDateTime(sale.entregadoAt)}</td>
                            <td>
                              <strong>{formatClpAmount(sale.montoTotal)}</strong>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="admin-btn-secondary"
                                onClick={() => openOrderDetail(sale.ordenId)}
                              >
                                Ver detalle
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {boardState.pageData.totalPages > 1 && (
                  <nav className="admin-pagination" aria-label="Paginación de ventas">
                    <button
                      type="button"
                      className="admin-btn-secondary"
                      disabled={boardState.pageData.first}
                      onClick={() => handlePageChange(boardState.pageData.number - 1)}
                    >
                      Anterior
                    </button>
                    <span>
                      Página {boardState.pageData.number + 1} de {boardState.pageData.totalPages}
                    </span>
                    <button
                      type="button"
                      className="admin-btn-secondary"
                      disabled={boardState.pageData.last}
                      onClick={() => handlePageChange(boardState.pageData.number + 1)}
                    >
                      Siguiente
                    </button>
                  </nav>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}