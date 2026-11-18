import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BrandArt } from '../components/BrandArt';
import { ProductImage } from '../components/ProductImage';
import './OrdersPage.css';
import { useAuth } from '../hooks/useAuth';
import { PaymentCheckout } from '../components/PaymentCheckout';
import { ReceiptDownload } from '../components/ReceiptDownload';
import { canDownloadReceipt } from '../services/receipts';
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
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const refresh = useRef<() => void>(() => {});
  const orderIds = purchase?.ordenes.map(order => order.ordenId).sort().join(',') ?? '';
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
    refresh.current = () => void load();
    void load();
    const focus = () => void load(); window.addEventListener('focus', focus);
    return () => { controller.abort(); window.removeEventListener('focus', focus); };
  }, [compraId, attempt]);
  useEffect(() => connectPurchaseRealtimeStream({ compraId, ordenIds: orderIds.split(',').filter(Boolean),
    onEvent: () => refresh.current(), onReconnect: () => refresh.current() }), [compraId, orderIds]);

  // Evitar que una respuesta tardía sobreviva al cambio de usuario/compra.
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function resolve(action: 'confirmar' | 'cancelar') {
    if (busy) return; setBusy(true); setError('');
    try {
      const updated = await (action === 'confirmar' ? confirmPurchase : cancelPurchase)(compraId, getPurchaseActionKey(compraId, action));
      if (active.current) { setPurchase(previous => reconcilePurchaseFromHttp(previous, updated)); clearPurchaseActionKey(compraId, action); }
    } catch (cause) {
      if (!active.current) return;
      if (cause instanceof ApiRequestError && cause.code === 'PRECIO_CAMBIO' && isPurchase(cause.extensions.compra)) setPurchase(cause.extensions.compra);
      if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status ?? 0)) setPurchase(null);
      if (!shouldReuseIdempotencyKey(cause)) clearPurchaseActionKey(compraId, action);
      setError(purchaseError(cause));
    } finally { if (active.current) setBusy(false); }
  }

  const selectedOrder = purchase?.ordenes.find(order => order.ordenId === selectedOrderId) ?? purchase?.ordenes[0];
  const statusLabel = (status: string) => status.replaceAll('_', ' ');
  return <section className="checkout-page orders-page" aria-labelledby="purchase-title">
    <Link className="orders-back" to="/compras">← Volver a mis compras</Link>
    <span className="eyebrow">☕ Seguimiento de tu pedido</span>
    <h1 id="purchase-title">Detalle de compra</h1>
    {error && <p role="alert">{error}</p>}
    {!purchase ? error ? <button className="btn-primary" onClick={() => setAttempt(v => v + 1)}>Reintentar</button> : <p role="status">Cargando compra…</p> : <>
      <p className="orders-intro">{purchaseDate(purchase.creadoAt)} · {purchase.ordenes.length} orden{purchase.ordenes.length === 1 ? '' : 'es'} por cafetería</p>
      <div className="orders-layout">
        <aside className="orders-sidebar"><h2>Selecciona una orden</h2>
          <div className="order-tabs" role="group" aria-label="Órdenes de la compra">
            {purchase.ordenes.map(order => <button type="button" key={order.ordenId}
              className={`order-tab${selectedOrder?.ordenId === order.ordenId ? ' selected' : ''}`}
              aria-pressed={selectedOrder?.ordenId === order.ordenId} onClick={() => setSelectedOrderId(order.ordenId)}>
              <strong>{order.codigoOrden ?? order.ordenId} · {order.cafeteriaNombre}</strong>
              <span className={`order-status status-${order.estado}`}>{statusLabel(order.estado)}</span>
              <span>{purchaseMoney(order.montoTotal)}</span>
            </button>)}
          </div><BrandArt className="orders-art" />
        </aside>
        <div className="orders-content">
          {selectedOrder && <article className="order-detail" id={`orden-${selectedOrder.ordenId}`} aria-label={`Detalle de orden ${selectedOrder.codigoOrden ?? selectedOrder.ordenId}`}>
            <header className="order-detail-header"><div><span className="eyebrow">📍 Retiro en cafetería</span><h2>{selectedOrder.cafeteriaNombre}</h2></div><span className={`order-status status-${selectedOrder.estado}`}>{statusLabel(selectedOrder.estado)}</span></header>
            <div className="order-folio"><span>Folio de tu orden</span><strong>{selectedOrder.codigoOrden ?? selectedOrder.ordenId}</strong></div>
            <h3>Productos comprados</h3>
            {selectedOrder.items?.length ? <ul className="order-products">{selectedOrder.items.map(item => <li key={item.ordenItemId}>
              <ProductImage productId={item.productoId} name={item.productoNombre} />
              <div><strong>{item.cantidad} × {item.productoNombre}</strong><span>{purchaseMoney(item.precioUnitario)} por unidad</span></div><strong>{purchaseMoney(item.subtotal)}</strong>
            </li>)}</ul> : <p>El detalle de productos no está disponible.</p>}
            <div className="order-total"><span>Total de la orden</span><strong>{purchaseMoney(selectedOrder.montoTotal)}</strong></div>
            {selectedOrder.retiroHasta && <p className="order-pickup">Plazo de retiro: {purchaseDate(selectedOrder.retiroHasta)}</p>}
            {canDownloadReceipt(purchase, selectedOrder) && <div className="order-receipt"><p>Comprobante de tu pedido</p><ReceiptDownload orderId={selectedOrder.ordenId} /></div>}
          </article>}
          <section className="purchase-summary" aria-label="Resumen de la compra">
            <h2>Compra {purchase.compraId}</h2><p>Estado: {statusLabel(purchase.estado)} · Pago: {statusLabel(paymentState(purchase))}</p>
            <div className="order-total"><span>Total de la compra</span><strong>{purchaseMoney(purchase.montoTotal)}</strong></div>
            <div className="purchase-actions">
              {purchase.estado === 'revision_requerida' && <button className="checkout-primary" disabled={busy} onClick={() => void resolve('confirmar')}>Confirmar disponibilidad</button>}
              {['revision_requerida', 'pendiente_pago'].includes(purchase.estado) && <button className="checkout-secondary" disabled={busy} onClick={() => void resolve('cancelar')}>Cancelar compra</button>}
            </div>
            {purchase.estado === 'pendiente_pago' && <PaymentCheckout compraId={compraId} />}
          </section>
        </div>
      </div>
    </>}
  </section>;
}
