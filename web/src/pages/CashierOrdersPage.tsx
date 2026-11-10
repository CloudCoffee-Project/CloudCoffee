import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { ApiRequestError } from '../services/httpClient';
import {
  CashierOrder,
  CashierOrderPage,
  connectCashierOrdersStream,
  formatOrderStatus,
  getCashierOrders,
  ORDER_STATUS_LABELS,
  OrderRealtimeEvent,
  OrderStatus,
  StreamConnectionState,
} from '../services/cashierOrders';
import './CashierOrdersPage.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; pageData: CashierOrderPage };

const PAGE_SIZE = 20;

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABELS) as Array<[OrderStatus, string]>;

const STREAM_STATE_LABELS: Record<StreamConnectionState, string> = {
  connecting: 'Conectando tiempo real…',
  connected: 'Conectado en tiempo real',
  reconnecting: 'Reconectando tiempo real…',
  disconnected: 'Tiempo real desconectado',
};

export function CashierOrdersPage() {
  const { cafeteriaId } = useAuth();
  const [estadoFilter, setEstadoFilter] = useState<string>('');
  const [codigoInput, setCodigoInput] = useState<string>('');
  const [appliedCodigo, setAppliedCodigo] = useState<string>('');
  const [page, setPage] = useState<number>(0);
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [streamState, setStreamState] = useState<StreamConnectionState>('disconnected');
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const estadoFilterRef = useRef(estadoFilter);
  estadoFilterRef.current = estadoFilter;

  const stateRef = useRef(state);
  stateRef.current = state;

  const triggerHttpReconcile = useCallback((reason?: string) => {
    if (reason) {
      setLastSyncMessage(reason);
    }
    setReloadToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!cafeteriaId) {
      setState({
        status: 'error',
        message: 'Tu sesión de cajero no tiene una cafetería asignada.',
      });
      return;
    }

    const controller = new AbortController();
    setState((prev) => (prev.status === 'success' && reloadToken > 0 ? prev : { status: 'loading' }));

    getCashierOrders(
      {
        page,
        size: PAGE_SIZE,
        estado: estadoFilter || undefined,
        codigoOrden: appliedCodigo || undefined,
      },
      controller.signal,
    )
      .then((pageData) => {
        if (!controller.signal.aborted) {
          setState({ status: 'success', pageData });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        const message =
          error instanceof ApiRequestError
            ? error.detail
            : 'No fue posible cargar los pedidos de la cafetería.';
        setState({ status: 'error', message });
      });

    return () => {
      controller.abort();
    };
  }, [cafeteriaId, page, estadoFilter, appliedCodigo, reloadToken]);

  useEffect(() => {
    if (!cafeteriaId) {
      setStreamState('disconnected');
      return;
    }

    const handleRealtimeEvent = (event: OrderRealtimeEvent) => {
      const { ordenId, estado, entregadoAt, version: incomingVersion } = event.payload;
      const eventTimestamp = event.timestamp || event.occurredAt;
      const currentState = stateRef.current;

      if (currentState.status !== 'success') {
        setLastSyncMessage(`Pedido actualizado en tiempo real (${formatOrderStatus(estado)}).`);
        setReloadToken((prev) => prev + 1);
        return;
      }

      const existingIndex = currentState.pageData.content.findIndex(
        (order) => order.ordenId === ordenId,
      );
      if (existingIndex === -1) {
        // Pedido nuevo descubierto por WebSocket: reconciliar por HTTP
        setLastSyncMessage(`Pedido actualizado en tiempo real (${formatOrderStatus(estado)}).`);
        setReloadToken((prev) => prev + 1);
        return;
      }

      const existingOrder = currentState.pageData.content[existingIndex];
      let shouldReconcileByHttp = false;

      if (incomingVersion !== undefined) {
        if (incomingVersion < existingOrder.version) {
          return;
        }
        if (
          incomingVersion === existingOrder.version &&
          event.eventType !== 'order.orden.entregada.v1'
        ) {
          return;
        }
        if (incomingVersion > existingOrder.version + 1) {
          shouldReconcileByHttp = true;
        }
      } else {
        shouldReconcileByHttp = true;
      }

      const currentFilter = estadoFilterRef.current;
      if (currentFilter && currentFilter !== estado) {
        shouldReconcileByHttp = true;
      }

      setLastSyncMessage(`Pedido actualizado en tiempo real (${formatOrderStatus(estado)}).`);

      setState((prev) => {
        if (prev.status !== 'success') {
          return prev;
        }

        let updatedContent: CashierOrder[];
        if (currentFilter && currentFilter !== estado) {
          updatedContent = prev.pageData.content.filter((order) => order.ordenId !== ordenId);
        } else {
          updatedContent = prev.pageData.content.map((order) =>
            order.ordenId === ordenId
              ? {
                  ...order,
                  estado,
                  entregadoAt: entregadoAt !== undefined ? entregadoAt : order.entregadoAt,
                  actualizadoAt: eventTimestamp || order.actualizadoAt,
                  version: incomingVersion ?? order.version,
                }
              : order,
          );
        }

        return {
          status: 'success',
          pageData: {
            ...prev.pageData,
            content: updatedContent,
            empty: updatedContent.length === 0,
          },
        };
      });

      if (shouldReconcileByHttp) {
        // Reconciliar silenciosamente por HTTP ante pedidos nuevos, saltos de versión o cambio de filtro
        setReloadToken((prev) => prev + 1);
      }
    };

    const disconnect = connectCashierOrdersStream({
      cafeteriaId,
      onEvent: handleRealtimeEvent,
      onReconnect: () => {
        triggerHttpReconcile('Conexión restablecida: pedidos reconciliados con el servidor.');
      },
      onConnectionStateChange: setStreamState,
    });

    return () => {
      disconnect();
    };
  }, [cafeteriaId, triggerHttpReconcile]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(0);
    setAppliedCodigo(codigoInput.trim());
  };

  const handleClearFilters = () => {
    setEstadoFilter('');
    setCodigoInput('');
    setAppliedCodigo('');
    setPage(0);
  };

  const formatCurrency = (amount: number, currency = 'CLP') =>
    new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <main className="cashier-orders-page">
      <header className="cashier-orders-header">
        <div>
          <span className="cashier-orders-badge">Operación de Cafetería</span>
          <h1>Panel de Cajero</h1>
          <p className="cashier-orders-subtitle">
            Visualización y seguimiento en tiempo real de pedidos de tu cafetería autorizada.
          </p>
        </div>

        <div className="cashier-orders-status-bar">
          <span
            className={`cashier-stream-pill cashier-stream-pill--${streamState}`}
            role="status"
            aria-live="polite"
          >
            {STREAM_STATE_LABELS[streamState]}
          </span>
          <button
            type="button"
            className="cashier-sync-button"
            onClick={() => triggerHttpReconcile('Listado sincronizado manualmente.')}
          >
            Sincronizar ahora
          </button>
        </div>
      </header>

      {lastSyncMessage && (
        <output className="cashier-sync-banner" aria-live="polite">
          {lastSyncMessage}
        </output>
      )}

      <section className="cashier-filters-card" aria-label="Filtros de pedidos">
        <form className="cashier-filters-form" onSubmit={handleSearchSubmit}>
          <div className="cashier-filter-group">
            <label htmlFor="cashier-estado-filter">Estado del pedido</label>
            <select
              id="cashier-estado-filter"
              value={estadoFilter}
              onChange={(e) => {
                setEstadoFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos los estados</option>
              {STATUS_OPTIONS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="cashier-filter-group">
            <label htmlFor="cashier-codigo-filter">Código de orden</label>
            <input
              id="cashier-codigo-filter"
              type="search"
              maxLength={64}
              placeholder="Ej: ORD-1001"
              value={codigoInput}
              onChange={(e) => setCodigoInput(e.target.value)}
            />
          </div>

          <div className="cashier-filter-actions">
            <button type="submit" className="cashier-btn-primary">
              Filtrar
            </button>
            {(estadoFilter || appliedCodigo || codigoInput) && (
              <button
                type="button"
                className="cashier-btn-secondary"
                onClick={handleClearFilters}
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </form>
      </section>

      {state.status === 'loading' && (
        <section className="cashier-feedback-card" role="status" aria-live="polite">
          <p>Cargando pedidos de la cafetería…</p>
        </section>
      )}

      {state.status === 'error' && (
        <section className="cashier-feedback-card cashier-feedback-card--error" role="alert">
          <h2>No se pudieron cargar los pedidos</h2>
          <p>{state.message}</p>
          <button
            type="button"
            className="cashier-btn-primary"
            onClick={() => triggerHttpReconcile()}
          >
            Reintentar
          </button>
        </section>
      )}

      {state.status === 'success' && state.pageData.content.length === 0 && (
        <section className="cashier-feedback-card" role="status">
          <h2>Sin pedidos para mostrar</h2>
          <p>No se encontraron pedidos con los criterios seleccionados en esta cafetería.</p>
        </section>
      )}

      {state.status === 'success' && state.pageData.content.length > 0 && (
        <>
          <section className="cashier-orders-grid" aria-label="Listado de pedidos">
            {state.pageData.content.map((order) => (
              <article key={order.ordenId} className="cashier-order-card">
                <div className="cashier-order-card__header">
                  <div>
                    <span className="cashier-order-code">{order.codigoOrden}</span>
                    <p className="cashier-order-cafeteria">{order.cafeteriaNombre}</p>
                  </div>
                  <span className={`cashier-order-status cashier-order-status--${order.estado}`}>
                    {formatOrderStatus(order.estado)}
                  </span>
                </div>

                <ul className="cashier-order-items" aria-label={`Ítems del pedido ${order.codigoOrden}`}>
                  {order.items.map((item) => (
                    <li key={item.ordenItemId} className="cashier-order-item">
                      <span>
                        <strong>{item.cantidad}x</strong> {item.productoNombre}
                      </span>
                      <span>{formatCurrency(item.subtotal, order.moneda)}</span>
                    </li>
                  ))}
                </ul>

                <div className="cashier-order-card__footer">
                  <span className="cashier-order-total-label">Total</span>
                  <strong className="cashier-order-total-value">
                    {formatCurrency(order.montoTotal, order.moneda)}
                  </strong>
                </div>
              </article>
            ))}
          </section>

          <nav className="cashier-pagination" aria-label="Paginación de pedidos">
            <button
              type="button"
              className="cashier-btn-secondary"
              disabled={state.pageData.first}
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            >
              Anterior
            </button>
            <span className="cashier-pagination-info">
              Página {state.pageData.number + 1} de {Math.max(1, state.pageData.totalPages)} (
              {state.pageData.totalElements} pedidos)
            </span>
            <button
              type="button"
              className="cashier-btn-secondary"
              disabled={state.pageData.last}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Siguiente
            </button>
          </nav>
        </>
      )}
    </main>
  );
}