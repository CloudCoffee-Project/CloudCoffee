import { useEffect, useState, type FormEvent } from 'react';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import {
  getCampus, getCategories, getProducts,
  type Campus, type Category, type ProductFilters, type ProductPage,
} from '../services/catalog';
import { ApiRequestError } from '../services/httpClient';
import './CatalogPage.css';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T };

function errorMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.detail : 'No se pudo cargar el catálogo.';
}

export function CatalogPage() {
  const [options, setOptions] = useState<LoadState<{ campus: Campus[]; categories: Category[] }>>({ status: 'loading' });
  const [filters, setFilters] = useState<ProductFilters>({ campusId: '', categoriaId: '', q: '', page: 0 });
  const [searchText, setSearchText] = useState('');
  const [products, setProducts] = useState<{ filters: ProductFilters; result: LoadState<ProductPage> }>();
  const [optionsRetry, setOptionsRetry] = useState(0);
  const [productsRetry, setProductsRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setOptions({ status: 'loading' });
    async function loadOptions() {
      try {
        const [campus, categories] = await Promise.all([
          getCampus(controller.signal), getCategories(controller.signal),
        ]);
        if (!controller.signal.aborted) {
          setOptions({ status: 'success', data: { campus, categories } });
        }
      } catch (error) {
        if (!controller.signal.aborted) setOptions({ status: 'error', message: errorMessage(error) });
      }
    }
    void loadOptions();
    return () => controller.abort();
  }, [optionsRetry]);

  useEffect(() => {
    if (!filters.campusId) return;
    const controller = new AbortController();
    setProducts({ filters, result: { status: 'loading' } });
    async function loadProducts() {
      try {
        const data = await getProducts(filters, controller.signal);
        if (controller.signal.aborted) return;
        // Si el total disminuyó, recuperar la última página que todavía existe.
        if (data.number > 0 && data.number >= data.totalPages) {
          setFilters({ ...filters, page: Math.max(0, data.totalPages - 1) });
          return;
        }
        setProducts({ filters, result: { status: 'success', data } });
      } catch (error) {
        if (!controller.signal.aborted) {
          setProducts({ filters, result: { status: 'error', message: errorMessage(error) } });
        }
      }
    }
    void loadProducts();
    return () => controller.abort();
  }, [filters, productsRetry]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = searchText.trim();
    setSearchText(q);
    setFilters({ ...filters, q, page: 0 });
  }

  const result = products?.filters === filters ? products.result : { status: 'loading' as const };

  return (
    <section className="catalog" aria-labelledby="catalog-title">
      <h1 id="catalog-title">Catálogo</h1>
      <p>Encuentra productos disponibles en tu campus.</p>

      {options.status === 'loading' && <div role="status"><LoadingSpinner />Cargando catálogo…</div>}
      {options.status === 'error' && (
        <div role="alert">
          <ErrorState message={options.message} />
          <button className="btn-primary" onClick={() => setOptionsRetry((retry) => retry + 1)}>Reintentar</button>
        </div>
      )}
      {options.status === 'success' && (options.data.campus.length === 0 ? (
        <p role="status">No hay campus disponibles.</p>
      ) : (
        <>
          <form className="catalog-filters" role="search" aria-label="Buscar productos" onSubmit={search}>
            <label>
              Campus
              <select value={filters.campusId} onChange={(event) => {
                setSearchText('');
                setFilters({ campusId: event.target.value, categoriaId: '', q: '', page: 0 });
              }}>
                <option value="">Selecciona un campus</option>
                {options.data.campus.map((campus) => <option key={campus.id} value={campus.id}>{campus.nombre}</option>)}
              </select>
            </label>
            <label>
              Categoría
              <select disabled={!filters.campusId} value={filters.categoriaId} onChange={(event) => {
                setFilters({ ...filters, categoriaId: event.target.value, page: 0 });
              }}>
                <option value="">Todas las categorías</option>
                {options.data.categories.map((category) => <option key={category.id} value={category.id}>{category.nombre}</option>)}
              </select>
            </label>
            <label className="catalog-search">
              Buscar por nombre o descripción
              <input type="search" disabled={!filters.campusId} value={searchText}
                placeholder="Ej. café" onChange={(event) => setSearchText(event.target.value)} />
            </label>
            <button className="btn-primary" type="submit" disabled={!filters.campusId}>Buscar</button>
          </form>

          {!filters.campusId ? <p role="status">Selecciona un campus para ver sus productos.</p> : (
            <div aria-busy={result.status === 'loading'}>
              {result.status === 'loading' && <div role="status"><LoadingSpinner />Cargando productos…</div>}
              {result.status === 'error' && (
                <div role="alert">
                  <ErrorState message={result.message} />
                  <button className="btn-primary" onClick={() => setProductsRetry((retry) => retry + 1)}>Reintentar</button>
                </div>
              )}
              {result.status === 'success' && (
                <>
                  <p role="status">
                    {result.data.totalElements === 0 ? 'No se encontraron productos con estos filtros.' :
                      `${result.data.totalElements} ${result.data.totalElements === 1 ? 'producto' : 'productos'} · Página ${result.data.number + 1} de ${result.data.totalPages}`}
                  </p>
                  <ul className="catalog-products">
                    {result.data.content.map((product) => (
                      <li className="catalog-product" key={product.id}>
                        {product.imagenUrl && <img src={product.imagenUrl} alt="" loading="lazy" />}
                        <h2>{product.nombre}</h2>
                        {product.descripcion && <p>{product.descripcion}</p>}
                      </li>
                    ))}
                  </ul>
                  {result.data.totalPages > 1 && (
                    <nav className="catalog-pagination" aria-label="Paginación del catálogo">
                      <button className="btn-primary" disabled={result.data.first} onClick={() => {
                        setFilters({ ...filters, page: result.data.number - 1 });
                      }}>Anterior</button>
                      <span>Página {result.data.number + 1} de {result.data.totalPages}</span>
                      <button className="btn-primary" disabled={result.data.last} onClick={() => {
                        setFilters({ ...filters, page: result.data.number + 1 });
                      }}>Siguiente</button>
                    </nav>
                  )}
                </>
              )}
            </div>
          )}
        </>
      ))}
    </section>
  );
}
