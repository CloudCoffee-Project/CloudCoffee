import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  CART_UPDATED_EVENT,
  clearCartItems,
  connectCatalogStockStream,
  readCartItems,
  reconcileCartWithStock,
  removeCartItem,
  updateCartItemQuantity,
  type CartItem,
} from '../services/catalog';
import { AUTH_SESSION_EVENT } from '../services/httpClient';
import { decodeSessionToken } from '../utils/jwt';
import './CartPage.css';

const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

function formatPrice(price: number): string {
  return clpFormatter.format(price);
}

function groupItemsByCafeteria(items: CartItem[]): Map<string, CartItem[]> {
  const groups = new Map<string, CartItem[]>();
  for (const item of items) {
    const group = groups.get(item.cafeteriaId) ?? [];
    group.push(item);
    groups.set(item.cafeteriaId, group);
  }
  return groups;
}

export function CartPage() {
  const [items, setItems] = useState<CartItem[]>(() => readCartItems());
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    const refreshItems = () => {
      setItems(readCartItems());
      setStorageError('');
    };
    window.addEventListener(CART_UPDATED_EVENT, refreshItems);
    window.addEventListener('storage', refreshItems);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, refreshItems);
      window.removeEventListener('storage', refreshItems);
    };
  }, []);
  const [sessionUserId, setSessionUserId] = useState<string | null>(
    () => decodeSessionToken(localStorage.getItem('accessToken') ?? '')?.userId ?? null,
  );
  const previousUserIdRef = useRef<string | null>(sessionUserId);

  useEffect(() => {
    const syncSession = () => {
      const token = localStorage.getItem('accessToken');
      const nextUserId = token ? (decodeSessionToken(token)?.userId ?? null) : null;
      if (previousUserIdRef.current && previousUserIdRef.current !== nextUserId) {
        clearCartItems();
        setItems([]);
      }
      previousUserIdRef.current = nextUserId;
      setSessionUserId(nextUserId);
    };

    window.addEventListener(AUTH_SESSION_EVENT, syncSession);
    window.addEventListener('storage', syncSession);
    return () => {
      window.removeEventListener(AUTH_SESSION_EVENT, syncSession);
      window.removeEventListener('storage', syncSession);
    };
  }, []);

  const cartCafeteriaIdsKey = [...new Set(items.map((item) => item.cafeteriaId))].sort().join(',');

  useEffect(() => {
    if (!sessionUserId || !cartCafeteriaIdsKey) return;

    return connectCatalogStockStream({
      cafeteriaIds: cartCafeteriaIdsKey.split(',').filter(Boolean),
      onStockEvent: (event) => {
        reconcileCartWithStock(
          event.payload.ofertaId,
          event.payload.stockActual,
          event.payload.version,
        );
      },
      onReconnect: () => {
        setItems(readCartItems());
      },
    });
  }, [sessionUserId, cartCafeteriaIdsKey]);

  function changeQuantity(offerId: string, quantity: number) {
    try {
      const updatedItem = updateCartItemQuantity(offerId, quantity);
      if (updatedItem) {
        setItems(readCartItems());
        setStorageError('');
      }
    } catch {
      setStorageError('No se pudo actualizar el carrito. Inténtalo nuevamente.');
    }
  }

  function deleteItem(offerId: string) {
    try {
      removeCartItem(offerId);
      setItems(readCartItems());
      setStorageError('');
    } catch {
      setStorageError('No se pudo quitar el producto. Inténtalo nuevamente.');
    }
  }

  const cafeteriaGroups = groupItemsByCafeteria(items);
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <section className="cart-page" aria-labelledby="cart-title">
      <header className="cart-page-header">
        <div>
          <h1 id="cart-title">Tu carrito</h1>
          <p>Revisa las cantidades y ofertas antes de continuar.</p>
        </div>
        {items.length > 0 && (
          <Link className="cart-continue-link" to="/catalogo">Seguir comprando</Link>
        )}
      </header>

      {storageError && <p className="cart-error" role="alert">{storageError}</p>}

      {items.length === 0 ? (
        <div className="cart-empty" role="status">
          <h2>Tu carrito está vacío</h2>
          <p>Explora el catálogo y agrega ofertas de tus cafeterías favoritas.</p>
          <Link className="btn-primary cart-catalog-link" to="/catalogo">Ir al catálogo</Link>
        </div>
      ) : (
        <>
          <div className="cart-groups">
            {[...cafeteriaGroups.entries()].map(([cafeteriaId, cafeteriaItems]) => {
              const cafeteriaTotal = cafeteriaItems.reduce(
                (sum, item) => sum + item.price * item.quantity,
                0,
              );
              return (
                <section
                  className="cart-cafeteria"
                  key={cafeteriaId}
                  aria-labelledby={`cart-cafeteria-${cafeteriaId}`}
                >
                  <h2 id={`cart-cafeteria-${cafeteriaId}`}>
                    {cafeteriaItems[0].cafeteriaName}
                  </h2>
                  <ul className="cart-items">
                    {cafeteriaItems.map((item) => (
                      <li className="cart-item" key={item.offerId}>
                        <div className="cart-item-details">
                          <h3>{item.productName}</h3>
                          <p>{formatPrice(item.price)} por unidad</p>
                          <p className="cart-item-stock">
                            {item.stock > 0 ? `Stock registrado: ${item.stock}` : 'Sin stock disponible'}
                          </p>
                        </div>
                        <div className="cart-item-actions">
                          <div className="cart-quantity">
                            <button
                              type="button"
                              aria-label={`Quitar una unidad de ${item.productName} de ${item.cafeteriaName}`}
                              disabled={item.quantity <= 1}
                              onClick={() => changeQuantity(item.offerId, item.quantity - 1)}
                            >
                              −
                            </button>
                            <label>
                              <span className="visually-hidden">
                                Cantidad de {item.productName} en {item.cafeteriaName}
                              </span>
                              <input
                                type="number"
                                min={1}
                                max={item.stock}
                                value={item.quantity}
                                onChange={(event) => {
                                  const value = Number(event.target.value);
                                  if (Number.isFinite(value) && value >= 1) {
                                    changeQuantity(item.offerId, value);
                                  }
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              aria-label={`Agregar una unidad de ${item.productName} de ${item.cafeteriaName}`}
                              disabled={item.quantity >= item.stock}
                              onClick={() => changeQuantity(item.offerId, item.quantity + 1)}
                            >
                              +
                            </button>
                          </div>
                          <strong>{formatPrice(item.price * item.quantity)}</strong>
                          <button
                            type="button"
                            className="cart-remove-button"
                            onClick={() => deleteItem(item.offerId)}
                          >
                            Quitar
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="cart-cafeteria-total">
                    Subtotal {cafeteriaItems[0].cafeteriaName}: <strong>{formatPrice(cafeteriaTotal)}</strong>
                  </p>
                </section>
              );
            })}
          </div>
          <aside className="cart-total" aria-label="Estimación del carrito">
            <span>Estimación</span>
            <strong>{formatPrice(total)}</strong>
          </aside>
          <Link className="btn-primary cart-checkout-link" to="/checkout">
            Continuar al checkout
          </Link>
        </>
      )}
    </section>
  );
}
