import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { BrandArt } from '../components/BrandArt';
import { CatalogPage } from './CatalogPage';
import { getCampus, type Campus } from '../services/catalog';
import { selectedCampusId, selectCampus } from '../services/selectedCampus';
import './CampusPage.css';

export function CatalogEntry() {
  const [params, setParams] = useSearchParams();
  const campusId = params.get('campusId') || selectedCampusId();

  if (!campusId) return <Navigate to="/campus" replace />;

  return (
    <CatalogPage
      key={campusId}
      initialCampusId={campusId}
      onCampusChange={id => setParams({ campusId: id }, { replace: true })}
    />
  );
}

function campusIcon(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('san juan pablo')) return '🌲';
  if (normalized.includes('menchaca lira')) return '🎨';
  if (normalized.includes('rivas del canto')) return '🔬';
  return '🏛️';
}

export function CampusPage({ mode = 'select' }: { mode?: 'select' | 'change' }) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [savedCampus] = useState(selectedCampusId);
  const [campus, setCampus] = useState<Campus[]>();
  const [selected, setSelected] = useState(savedCampus);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    void getCampus(controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setCampus(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt]);

  const currentCampus = campus?.find(value => value.id === savedCampus);
  const choice = campus?.find(value => value.id === selected);
  const isChanging = mode === 'change' && Boolean(savedCampus) && (!campus || Boolean(currentCampus));
  const canContinue = Boolean(choice) && (!isChanging || selected !== savedCampus);
  const returnToCatalog = !state?.fromHome && Boolean(currentCampus);

  function continueToCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice || !canContinue) return;
    selectCampus(choice);
    document.documentElement.scrollTop = 0;
    navigate(`/catalogo?campusId=${encodeURIComponent(choice.id)}`, { replace: isChanging });
  }

  return (
    <section className="campus-page" aria-labelledby="campus-title">
      <div className="campus-intro">
        <Link className="campus-back" to={returnToCatalog ? '/catalogo' : '/'}>
          {returnToCatalog ? '← Volver al catálogo' : '← Volver al inicio'}
        </Link>
        <span className="eyebrow">📍 Selección de sede</span>
        <h1 id="campus-title">{isChanging ? 'Cambiar campus' : '¿En qué campus estás?'}</h1>
        <p>{isChanging
          ? 'Elige otra sede para ver su catálogo y las cafeterías disponibles.'
          : 'Elige tu sede actual para ver el stock y las cafeterías disponibles.'}</p>
        <BrandArt className="campus-art" />
      </div>

      <div className="campus-options">
        {error ? (
          <div role="alert">
            <p>No pudimos cargar los campus. Inténtalo nuevamente.</p>
            <button className="btn-primary" type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button>
          </div>
        ) : !campus ? (
          <p role="status">Cargando campus…</p>
        ) : campus.length === 0 ? (
          <p role="status">No hay campus disponibles.</p>
        ) : (
          <form onSubmit={continueToCatalog}>
            <fieldset>
              <legend className="visually-hidden">Selecciona tu campus</legend>
              {campus.map(({ id, nombre, direccion, cafeteriasActivas }) => (
                <label className="campus-option" key={id}>
                  <input
                    type="radio"
                    name="campus"
                    value={id}
                    checked={selected === id}
                    onChange={() => setSelected(id)}
                    aria-labelledby={`campus-name-${id}`}
                    aria-describedby={`campus-details-${id}`}
                  />
                  <span className="campus-icon" aria-hidden="true">{campusIcon(nombre)}</span>
                  <span className="campus-card-copy">
                    <strong id={`campus-name-${id}`}>{nombre}</strong>
                    <span className="campus-card-details" id={`campus-details-${id}`}>
                      {isChanging && id === savedCampus && <span className="campus-current">Campus actual</span>}
                      {direccion && <span>{direccion}</span>}
                      {typeof cafeteriasActivas === 'number' && (
                        <span className="campus-active-count">
                          <span aria-hidden="true">☕ </span>
                          {cafeteriasActivas === 1 ? '1 cafetería activa' : `${cafeteriasActivas} cafeterías activas`}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="campus-check" aria-hidden="true">{selected === id ? '✓' : '›'}</span>
                </label>
              ))}
            </fieldset>
            <button className="btn-primary campus-continue" type="submit" disabled={!canContinue}>
              {isChanging ? 'Confirmar cambio →' : 'Continuar al catálogo →'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
