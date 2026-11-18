import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { getPopularProducts } from '../services/popularProducts';
import type { ProductDetail } from '../services/catalog';
import { useSelectedCampusId } from '../services/selectedCampus';
import { ProductImage } from './ProductImage';

export function PopularProducts() {
  const campusId = useSelectedCampusId();
  const [products, setProducts] = useState<ProductDetail[]>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const track = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setProducts(undefined); setError(false);
    void getPopularProducts(campusId, controller.signal).then(value => {
      if (!controller.signal.aborted) { setProducts(value); track.current?.scrollTo({ left: 0 }); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [campusId, attempt]);
  function move(direction: number) {
    const list = track.current; if (!list) return;
    list.scrollBy({ left: direction * list.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  return <section className="popular-section" aria-label="Productos más pedidos" aria-roledescription="carrusel">
    <header><div><span className="eyebrow">Los favoritos de la comunidad</span><h2>Los más pedidos</h2><p>{campusId ? 'Los favoritos disponibles en tu campus.' : 'Descubre los favoritos de nuestras cafeterías.'}</p></div>
      {!!products?.length && <div className="carousel-controls"><button type="button" aria-label="Productos anteriores" onClick={() => move(-1)}>←</button><button type="button" aria-label="Productos siguientes" onClick={() => move(1)}>→</button></div>}
    </header>
    {error ? <div role="alert"><p>No pudimos cargar los productos más pedidos.</p><button className="btn-outline" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>
      : !products ? <p role="status">Cargando los favoritos…</p>
      : !products.length ? <p role="status">Pronto encontrarás aquí los favoritos. <Link to="/campus" state={{ fromHome: true }}>Explorar el catálogo →</Link></p>
      : <ul className="popular-track" ref={track}>{products.map((product, index) => <li key={product.id}>
        <Link className="popular-card" to={`/catalogo/productos/${encodeURIComponent(product.id)}${campusId ? `?campusId=${encodeURIComponent(campusId)}` : ''}`}>
          <div className="popular-photo"><ProductImage src={product.imagenUrl} name={product.nombre} /><span>#{index + 1}</span></div><h3>{product.nombre}</h3><p>{product.descripcion}</p><span className="popular-open">Ver producto →</span>
        </Link>
      </li>)}</ul>}
  </section>;
}
