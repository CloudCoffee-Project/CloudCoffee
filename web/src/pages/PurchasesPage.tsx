import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { ApiRequestError } from '../services/httpClient';
import { listPurchases, paymentState, type PurchasePage } from '../services/purchases';
import './CheckoutPage.css';

export const purchaseMoney = (monto: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(monto);
export const purchaseDate = (fecha?: string | null) => fecha ? new Date(fecha).toLocaleString('es-CL') : 'Sin fecha';
export const purchaseError = (cause: unknown) => cause instanceof ApiRequestError ? cause.detail : 'No se pudo consultar la compra. Vuelve a intentarlo.';

export function PurchasesPage() {
  const { userId } = useAuth();
  const [params] = useSearchParams();
  return <PurchaseHistory key={`${userId}:${params.get('page') ?? '0'}`} />;
}

function PurchaseHistory() {
  const [params, setParams] = useSearchParams();
  const input = Number(params.get('page') ?? 0);
  const page = Number.isSafeInteger(input) && input >= 0 ? input : 0;
  const [data, setData] = useState<PurchasePage | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setData(null); setError('');
    void listPurchases(page, abort.signal).then(value => { if (!abort.signal.aborted) setData(value); })
      .catch(cause => { if (!abort.signal.aborted) setError(purchaseError(cause)); });
    return () => abort.abort();
  }, [page, attempt]);
  return <section className="checkout-page">
    <h1>Mis Compras</h1>
    {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(v => v + 1)}>Reintentar</button></>
      : !data ? <p role="status">Cargando compras…</p> : <>
        {data.content.length === 0 ? <p>No hay compras en esta página. <Link to="/catalogo">Ir al catálogo</Link></p> : <ul className="purchase-history">
          {data.content.map(compra => <li className="checkout-result" key={compra.compraId}>
            <h2><Link to={`/compras/${encodeURIComponent(compra.compraId)}`}>Compra {compra.compraId}</Link></h2>
            <p>{purchaseDate(compra.creadoAt)} · {purchaseMoney(compra.montoTotal)}</p>
            <p>Estado: {compra.estado.replaceAll('_', ' ')} · Pago: {paymentState(compra).replaceAll('_', ' ')}</p>
            <p>{compra.ordenes.length} orden{compra.ordenes.length === 1 ? '' : 'es'} por cafetería</p>
          </li>)}
        </ul>}
        <nav aria-label="Paginación de compras">
          <button disabled={page === 0} onClick={() => setParams({ page: String(page - 1) })}>Anterior</button>
          <span> Página {page + 1} de {Math.max(data.totalPages, 1)} · {data.totalElements} compras </span>
          <button disabled={data.last} onClick={() => setParams({ page: String(page + 1) })}>Siguiente</button>
        </nav>
      </>}
  </section>;
}
