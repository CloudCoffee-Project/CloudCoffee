import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import {
  addOfferToCart,
  applyStockEventToOffers,
  clearCartItems,
  connectCatalogStockStream,
  getCampus,
  getProductById,
  getProductOffers,
  reconcileCartWithOffers,
  reconcileCartWithStock,
  type Campus,
  type ProductDetail,
  type ProductOffer,
} from '../services/catalog';
import { AUTH_SESSION_EVENT, ApiRequestError } from '../services/httpClient';
import { decodeSessionToken } from '../utils/jwt';
import './CatalogPage.css';

type ProductLoadState =
  | { status: 'loading' }
  | { status: 'not-found'; message: string }
  | { status: 'error'; message: string }
  | { status: 'success'; product: ProductDetail; campusList: Campus[] };

type OffersLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; offers: ProductOffer[] };

const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

function formatPrice(price: number): string {
  return clpFormatter.format(Number(price));
}

export function ProductDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialCampusId = searchParams.get('campusId') ?? '';

  const [productState, setProductState] = useState<ProductLoadState>({ status: 'loading' });
  const [selectedCampusId, setSelectedCampusId] = useState<string>(initialCampusId);
  const [offersState, setOffersState] = useState<OffersLoadState>({ status: 'idle' });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cartFeedback, setCartFeedback] = useState<string>('');
  const [productRetry, setProductRetry] = useState(0);
  const [offersRetry, setOffersRetry] = useState(0);
  const [sessionUserId, setSessionUserId] = useState<string | null>(
    () => decodeSessionToken(localStorage.getItem('accessToken') ?? '')?.userId ?? null,
  );
  const previousUserIdRef = useRef<string | null>(sessionUserId);
  const offerVersionsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const trimmedId = id.trim();
    if (!trimmedId) {
      setProductState({
        status: 'not-found',
        message: 'No existe un producto activo con el identificador indicado.',
      });
      return;
    }

    const controller = new AbortController();
    setProductState({ status: 'loading' });
    setCartFeedback('');

    async function loadProductAndCampus() {
      try {
        const [product, campusList] = await Promise.all([
          getProductById(trimmedId, controller.signal),
          getCampus(controller.signal),
        ]);
        if (controller.signal.aborted) return;

        setProductState({ status: 'success', product, campusList });
        setSelectedCampusId((current) => {
          if (current && campusList.some((c) => c.id === current)) {
            return current;
          }
          return campusList[0]?.id ?? '';
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && (error.status === 404 || error.status === 400)) {
          setProductState({
            status: 'not-found',
            message: error.status === 404
              ? error.detail
              : 'No existe un producto activo con el identificador indicado.',
          });
          return;
        }
        setProductState({
          status: 'error',
          message: error instanceof ApiRequestError
            ? error.detail
            : 'No se pudo cargar el detalle del producto.',
        });
      }
    }

    void loadProductAndCampus();
    return () => controller.abort();
  }, [id, productRetry]);

  useEffect(() => {
    if (productState.status !== 'success' || !selectedCampusId) {
      setOffersState({ status: 'idle' });
      return;
    }

    const { product } = productState;
    const controller = new AbortController();
    setOffersState({ status: 'loading' });

    async function loadOffers() {
      try {
        const offers = await getProductOffers(product.id, selectedCampusId, controller.signal);
        if (controller.signal.aborted) return;
        for (const offer of offers) {
          if (typeof offer.version === 'number') {
            offerVersionsRef.current.set(offer.id, offer.version);
          }
        }
        reconcileCartWithOffers(offers);
        setOffersState({ status: 'success', offers });
      } catch (error) {
        if (controller.signal.aborted) return;
        setOffersState({
          status: 'error',
          message: error instanceof ApiRequestError
            ? error.detail
            : 'No se pudieron cargar las ofertas del campus.',
        });
      }
    }
    void loadOffers();
    return () => controller.abort();
  }, [productState, selectedCampusId, offersRetry]);

  useEffect(() => {
    offerVersionsRef.current.clear();
  }, [selectedCampusId, id]);

  useEffect(() => {
    const syncSession = () => {
      const token = localStorage.getItem('accessToken');
      const nextUserId = token ? (decodeSessionToken(token)?.userId ?? null) : null;
      if (previousUserIdRef.current && previousUserIdRef.current !== nextUserId) {
        clearCartItems();
        setQuantities({});
        setCartFeedback('');
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

  const offerCafeteriaIdsKey =
    offersState.status === 'success'
      ? [...new Set(offersState.offers.map((offer) => offer.cafeteriaId))].sort().join(',')
      : '';

  useEffect(() => {
    if (!sessionUserId || !selectedCampusId || !offerCafeteriaIdsKey) {
      return;
    }

    const cafeteriaIds = offerCafeteriaIdsKey.split(',').filter(Boolean);
    return connectCatalogStockStream({
      cafeteriaIds,
      onStockEvent: (event) => {
        if (event.payload.campusId && event.payload.campusId !== selectedCampusId) {
          return;
        }

        reconcileCartWithStock(
          event.payload.ofertaId,
          event.payload.stockActual,
          event.payload.version,
        );

        let needsHttpReload = false;
        setOffersState((current) => {
          if (current.status !== 'success') return current;
          const result = applyStockEventToOffers(
            current.offers,
            event,
            offerVersionsRef.current,
          );
          needsHttpReload = result.requiresHttpReconciliation;
          if (!result.applied) return current;
          return { status: 'success', offers: result.offers };
        });

        if (needsHttpReload) {
          setOffersRetry((retry) => retry + 1);
          return;
        }

        setQuantities((current) => {
          const currentQty = current[event.payload.ofertaId];
          if (currentQty === undefined) return current;
          const nextStock = Math.max(0, Math.floor(event.payload.stockActual));
          if (nextStock <= 0) {
            return { ...current, [event.payload.ofertaId]: 1 };
          }
          if (currentQty > nextStock) {
            return { ...current, [event.payload.ofertaId]: nextStock };
          }
          return current;
        });
      },
      onReconnect: () => {
        setOffersRetry((retry) => retry + 1);
      },
    });
  }, [sessionUserId, selectedCampusId, offerCafeteriaIdsKey]);

  function handleCampusChange(campusId: string) {
    setSelectedCampusId(campusId);
    setCartFeedback('');
    if (campusId) {
      setSearchParams({ campusId }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }

  function handleAddToCart(offer: ProductOffer) {
    if (productState.status !== 'success') return;
    const qty = quantities[offer.id] ?? 1;
    const added = addOfferToCart(productState.product, offer, qty);
    if (added) {
      setCartFeedback(
        `Se agregó ${qty} ${qty === 1 ? 'unidad' : 'unidades'} de ${productState.product.nombre} (${offer.cafeteriaName}) al carrito.`,
      );
    }
  }

  return (
    <section
      className="catalog product-detail"
      aria-labelledby="product-detail-title"
      aria-busy={productState.status === 'loading'}
    >
      <nav className="product-detail-nav" aria-label="Navegación de catálogo">
        <Link to="/catalogo" className="product-detail-back">
          ← Volver al catálogo
        </Link>
      </nav>

      {productState.status === 'loading' && (
        <div role="status">
          <LoadingSpinner />
          <h1 id="product-detail-title">Cargando producto…</h1>
        </div>
      )}

      {productState.status === 'not-found' && (
        <div role="alert" className="product-detail-state">
          <h1 id="product-detail-title">Producto no encontrado</h1>
          <p>{productState.message}</p>
          <Link to="/catalogo" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Volver al catálogo
          </Link>
        </div>
      )}

      {productState.status === 'error' && (
        <div role="alert" className="product-detail-state">
          <h1 id="product-detail-title">No se pudo cargar el producto</h1>
          <ErrorState message={productState.message} />
          <div className="product-detail-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setProductRetry((retry) => retry + 1)}
            >
              Reintentar
            </button>
            <Link to="/catalogo" className="product-detail-back">
              Volver al catálogo
            </Link>
          </div>
        </div>
      )}

      {productState.status === 'success' && (
        <>
          <article className="product-detail-card">
            {productState.product.imagenUrl && (
              <img
                className="product-detail-image"
                src={productState.product.imagenUrl}
                alt={productState.product.nombre}
              />
            )}
            <div className="product-detail-info">
              <span className="product-detail-category">
                {productState.product.categoria.nombre}
              </span>
              <h1 id="product-detail-title">{productState.product.nombre}</h1>
              <p className="product-detail-description">
                {productState.product.descripcion?.trim() || 'Sin descripción disponible.'}
              </p>
            </div>
          </article>

          <section className="product-detail-offers" aria-labelledby="offers-section-title">
            <div className="product-detail-offers-header">
              <h2 id="offers-section-title">Ofertas disponibles por cafetería</h2>
              {productState.campusList.length > 0 && (
                <label className="product-detail-campus-select">
                  Campus
                  <select
                    value={selectedCampusId}
                    onChange={(event) => handleCampusChange(event.target.value)}
                  >
                    <option value="">Selecciona un campus</option>
                    {productState.campusList.map((campus) => (
                      <option key={campus.id} value={campus.id}>
                        {campus.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {cartFeedback && (
              <p className="product-detail-cart-feedback" role="status">
                {cartFeedback}
              </p>
            )}

            {productState.campusList.length === 0 ? (
              <p role="status">No hay campus disponibles para consultar ofertas.</p>
            ) : !selectedCampusId ? (
              <p role="status">Selecciona un campus para ver las ofertas de este producto.</p>
            ) : (
              <div aria-busy={offersState.status === 'loading'}>
                {offersState.status === 'loading' && (
                  <div role="status">
                    <LoadingSpinner />
                    Cargando ofertas…
                  </div>
                )}

                {offersState.status === 'error' && (
                  <div role="alert">
                    <ErrorState message={offersState.message} />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setOffersRetry((retry) => retry + 1)}
                    >
                      Reintentar ofertas
                    </button>
                  </div>
                )}

                {offersState.status === 'success' && (
                  offersState.offers.length === 0 ? (
                    <p role="status">No hay ofertas disponibles para este producto en el campus seleccionado.</p>
                  ) : (
                    <ul className="product-offers-list">
                      {offersState.offers.map((offer) => {
                        const available = offer.disponible && offer.stock > 0;
                        const selectedQty = quantities[offer.id] ?? 1;

                        return (
                          <li key={offer.id} className="product-offer-item">
                            <div className="product-offer-details">
                              <h3>{offer.cafeteriaName}</h3>
                              <p className="product-offer-price">{formatPrice(offer.price)}</p>
                              <p className="product-offer-stock">
                                {available ? `Stock disponible: ${offer.stock}` : 'Sin stock disponible'}
                              </p>
                            </div>

                            <div className="product-offer-actions">
                              {available && (
                                <label className="product-offer-qty">
                                  Cantidad para {offer.cafeteriaName}
                                  <input
                                    type="number"
                                    min={1}
                                    max={offer.stock}
                                    value={selectedQty}
                                    onChange={(event) => {
                                      const parsed = Number.parseInt(event.target.value, 10);
                                      const clamped = Number.isNaN(parsed)
                                        ? 1
                                        : Math.max(1, Math.min(offer.stock, parsed));
                                      setQuantities((prev) => ({ ...prev, [offer.id]: clamped }));
                                    }}
                                  />
                                </label>
                              )}
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={!available}
                                onClick={() => handleAddToCart(offer)}
                              >
                                {available ? 'Agregar al carrito' : 'Sin stock'}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )
                )}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
