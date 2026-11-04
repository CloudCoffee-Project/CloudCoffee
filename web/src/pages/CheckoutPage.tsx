import { useState } from 'react';
import { Link } from 'react-router';
import {
  CART_UPDATED_EVENT,
  CART_STORAGE_KEY,
  readCartItems,
  type CartItem,
} from '../services/catalog';
import { ApiRequestError } from '../services/httpClient';
import {
  cancelPurchase,
  clearPendingPurchaseCreation,
  clearPurchaseActionKey,
  clearSavedPurchase,
  confirmPurchase,
  createPurchase,
  getPurchaseActionKey,
  isPurchase,
  newIdempotencyKey,
  readPendingPurchaseCreation,
  readSavedPurchase,
  savePendingPurchaseCreation,
  savePurchase,
  shouldReuseIdempotencyKey,
  type PendingPurchaseCreation,
  type Purchase,
  type PurchaseRequestItem,
} from '../services/purchases';
import './CheckoutPage.css';

const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

function formatPrice(amount: number): string {
  return clpFormatter.format(amount);
}

function purchaseErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) {
    return 'No se pudo completar la operación. Inténtalo nuevamente.';
  }

  if (error.code === 'STOCK_INSUFICIENTE') {
    return 'El stock cambió y no se pudo confirmar la compra. Puedes volver a intentarlo o cancelarla.';
  }
  if (error.code === 'PRECIO_CAMBIO') {
    return 'El precio cambió. Revisa el total actualizado antes de volver a confirmar.';
  }
  if (error.code === 'IDEMPOTENCY_IN_PROGRESS' || error.code === 'OPERACION_PENDIENTE') {
    return 'La operación sigue procesándose. Reintenta en unos segundos; se conservará la misma clave.';
  }
  return error.detail;
}

function requestItems(items: CartItem[]): PurchaseRequestItem[] {
  return items.map(({ offerId, quantity }) => ({
    ofertaId: offerId,
    cantidad: quantity,
  }));
}

function clearCart(): void {
  localStorage.removeItem(CART_STORAGE_KEY);
  window.dispatchEvent(new Event(CART_UPDATED_EVENT));
}

export function CheckoutPage() {
  const [pendingIntent, setPendingIntent] = useState<PendingPurchaseCreation | null>(
    () => readPendingPurchaseCreation(),
  );
  const [purchase, setPurchase] = useState<Purchase | null>(() => readSavedPurchase());
  const [cartItems, setCartItems] = useState<CartItem[]>(
    () => pendingIntent?.cartSnapshot ?? readCartItems(),
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitPurchase() {
    if (!pendingIntent && cartItems.length === 0) return;
    setIsSubmitting(true);
    setErrorMessage('');

    let intent = pendingIntent;
    try {
      if (!intent) {
        intent = {
          idempotencyKey: newIdempotencyKey(),
          items: requestItems(cartItems),
          cartSnapshot: cartItems,
        };
        savePendingPurchaseCreation(intent);
        setPendingIntent(intent);
      }

      const createdPurchase = await createPurchase(intent.items, intent.idempotencyKey);
      savePurchase(createdPurchase);
      clearPendingPurchaseCreation();
      clearCart();
      setPendingIntent(null);
      setCartItems([]);
      setPurchase(createdPurchase);
    } catch (error) {
      if (!shouldReuseIdempotencyKey(error)) {
        clearPendingPurchaseCreation();
        setPendingIntent(null);
      }
      setErrorMessage(purchaseErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function resolvePurchase(action: 'confirmar' | 'cancelar') {
    if (!purchase) return;
    setIsSubmitting(true);
    setErrorMessage('');
    const key = getPurchaseActionKey(purchase.compraId, action);

    try {
      const updatedPurchase = action === 'confirmar'
        ? await confirmPurchase(purchase.compraId, key)
        : await cancelPurchase(purchase.compraId, key);
      savePurchase(updatedPurchase);
      clearPurchaseActionKey(purchase.compraId, action);
      setPurchase(updatedPurchase);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'PRECIO_CAMBIO') {
        const updatedPurchase = error.extensions.compra;
        if (isPurchase(updatedPurchase)) {
          savePurchase(updatedPurchase);
          setPurchase(updatedPurchase);
        }
      }
      if (!shouldReuseIdempotencyKey(error)) {
        clearPurchaseActionKey(purchase.compraId, action);
      }
      setErrorMessage(purchaseErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function startNewPurchase() {
    clearSavedPurchase();
    clearPendingPurchaseCreation();
    setPurchase(null);
    const updatedItems = readCartItems();
    setCartItems(updatedItems);
    setPendingIntent(null);
    setErrorMessage('');
  }

  const canResolveReview = purchase?.estado === 'revision_requerida';
  const canCancel = purchase && ['revision_requerida', 'pendiente_pago'].includes(purchase.estado);

  return (
    <section className="checkout-page" aria-labelledby="checkout-title">
      <header className="checkout-header">
        <div>
          <h1 id="checkout-title">Checkout</h1>
          <p>La disponibilidad y el total definitivo se validan en el servidor.</p>
        </div>
        {!purchase && <Link to="/carrito">Volver al carrito</Link>}
      </header>

      {errorMessage && <p className="checkout-error" role="alert">{errorMessage}</p>}

      {purchase ? (
        <section className="checkout-result" aria-live="polite">
          <h2>Compra {purchase.compraId}</h2>
          <p className="checkout-status">Estado: <strong>{purchase.estado.replaceAll('_', ' ')}</strong></p>
          <p className="checkout-server-total">
            Total informado por el servidor: <strong>{formatPrice(purchase.montoTotal)}</strong>
          </p>
          <ul className="checkout-orders">
            {purchase.ordenes.map((order) => (
              <li key={order.ordenId}>
                <span>{order.cafeteriaNombre}</span>
                <span>{order.estado.replaceAll('_', ' ')}</span>
                <strong>{formatPrice(order.montoTotal)}</strong>
              </li>
            ))}
          </ul>
          {canResolveReview && (
            <p className="checkout-review-note" role="status">
              Una o más cafeterías requieren revisar stock. Puedes confirmar nuevamente la reserva o cancelar la compra.
            </p>
          )}
          {canResolveReview && (
            <button type="button" className="checkout-primary" disabled={isSubmitting} onClick={() => void resolvePurchase('confirmar')}>
              {isSubmitting ? 'Procesando…' : 'Confirmar disponibilidad'}
            </button>
          )}
          {canCancel && (
            <button type="button" className="checkout-secondary" disabled={isSubmitting} onClick={() => void resolvePurchase('cancelar')}>
              Cancelar compra
            </button>
          )}
          {purchase.estado === 'pendiente_pago' && (
            <p role="status">Compra confirmada. El siguiente paso de pago estará disponible en el flujo de pagos.</p>
          )}
          {purchase.estado === 'cancelado' && <p role="status">La compra fue cancelada.</p>}
          <button type="button" className="checkout-new-purchase" onClick={startNewPurchase}>
            Nueva compra
          </button>
        </section>
      ) : cartItems.length === 0 ? (
        <div className="checkout-empty">
          <p>No hay productos para comprar.</p>
          <Link className="checkout-primary" to="/catalogo">Ir al catálogo</Link>
        </div>
      ) : (
        <section className="checkout-review">
          <h2>Productos a solicitar</h2>
          <ul>
            {cartItems.map((item) => (
              <li key={item.offerId}>
                <span>{item.productName} · {item.cafeteriaName}</span>
                <span>{item.quantity} unidad{item.quantity === 1 ? '' : 'es'}</span>
              </li>
            ))}
          </ul>
          <p>Los precios del carrito son referenciales. El total que se mostrará tras crear la compra será el calculado por el servidor.</p>
          <button type="button" className="checkout-primary" disabled={isSubmitting} onClick={() => void submitPurchase()}>
            {isSubmitting
              ? 'Enviando…'
              : pendingIntent
                ? 'Reintentar creación'
                : 'Crear compra'}
          </button>
        </section>
      )}
    </section>
  );
}
