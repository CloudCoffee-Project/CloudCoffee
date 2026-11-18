import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { PaymentCheckout } from '../components/PaymentCheckout';
import { ApiRequestError } from '../services/httpClient';
import { cancelPurchase, clearPurchaseActionKey, confirmPurchase, connectPurchaseRealtimeStream,
  getPurchase, getPurchaseActionKey, isPurchase, paymentState, reconcilePurchaseFromHttp,
  shouldReuseIdempotencyKey, type Purchase } from '../services/purchases';
import { purchaseDate, purchaseError, purchaseMoney } from './PurchasesPage';

export function PurchaseDetailPage() {
  const { compraId = '' } = useParams();
  const { userId } = useAuth();
  return <PurchaseDetail key={`${userId}:${compraId}`} compraId={compraId} />;
}

function PurchaseDetail({ compraId }: { compraId: string }) {
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    async function load() {
      const current = ++sequence;
      try {
        const fresh = await getPurchase(compraId, controller.signal);
        if (!controller.signal.aborted && current === sequence) {
          setPurchase(previous => reconcilePurchaseFromHttp(previous, fresh)); setError('');
        }
      } catch (cause) {
        if (!controller.signal.aborted && current === sequence) { setPurchase(null); setError(purchaseError(cause)); }
      }
    }
    void load();
    const disconnect = connectPurchaseRealtimeStream({ compraId, onEvent: () => void load(), onReconnect: () => void load() });
    const focus = () => void load(); window.addEventListener('focus', focus);
    return () => { controller.abort(); disconnect(); window.removeEventListener('focus', focus); };
  }, [compraId, attempt]);

  // Evitar que una respuesta tardía sobreviva al cambio de usuario/compra.
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function resolve(action: 'confirmar' | 'cancelar') {
    if (busy) return; setBusy(true); setError('');
    try {
      const updated = await (action === 'confirmar' ? confirmPurchase : cancelPurchase)(compraId, getPurchaseActionKey(compraId, action));
      if (active.current) { setPurchase(updated); clearPurchaseActionKey(compraId, action); }
    } catch (cause) {
      if (!active.current) return;
      if (cause instanceof ApiRequestError && cause.code === 'PRECIO_CAMBIO' && isPurchase(cause.extensions.compra)) setPurchase(cause.extensions.compra);
      if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status ?? 0)) setPurchase(null);
      if (!shouldReuseIdempotencyKey(cause)) clearPurchaseActionKey(compraId, action);
      setError(purchaseError(cause));
    } finally { if (active.current) setBusy(false); }
  }

  return <section className="checkout-page">
    <Link to="/compras">Volver a mis compras</Link>
    <h1>Detalle de compra</h1>
    {error && <p role="alert">{error}</p>}
    {!purchase ? error ? <button onClick={() => setAttempt(v => v + 1)}>Reintentar</button> : <p role="status">Cargando compra…</p> : <>
      <h2>Compra {purchase.compraId}</h2>
      <p>{purchaseDate(purchase.creadoAt)} · {purchaseMoney(purchase.montoTotal)}</p>
      <p>Estado: {purchase.estado.replaceAll('_', ' ')} · Pago: {paymentState(purchase).replaceAll('_', ' ')}</p>
      {purchase.estado === 'revision_requerida' && <button className="checkout-primary" disabled={busy} onClick={() => void resolve('confirmar')}>Confirmar disponibilidad</button>}
      {['revision_requerida', 'pendiente_pago'].includes(purchase.estado) && <button className="checkout-secondary" disabled={busy} onClick={() => void resolve('cancelar')}>Cancelar compra</button>}
      {purchase.estado === 'pendiente_pago' && <PaymentCheckout compraId={compraId} />}
      <ul className="purchase-history">{purchase.ordenes.map(order => <li className="checkout-result" key={order.ordenId} id={`orden-${order.ordenId}`}>
        <h3>{order.cafeteriaNombre}</h3>
        <p>Orden {order.codigoOrden ?? order.ordenId} · {order.estado.replaceAll('_', ' ')}</p>
        <ul>{order.items?.map(item => <li key={item.ordenItemId}>{item.cantidad} × {item.productoNombre} · {purchaseMoney(item.precioUnitario)} · Subtotal {purchaseMoney(item.subtotal)}</li>)}</ul>
        <p>Total de la orden: {purchaseMoney(order.montoTotal)}</p>
        {order.retiroHasta && <p>Plazo de retiro: {purchaseDate(order.retiroHasta)}</p>}
      </li>)}</ul>
    </>}
  </section>;
}
