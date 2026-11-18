import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { BrandArt } from '../components/BrandArt';
import { CatalogPage } from './CatalogPage';
import { getCampus, type Campus } from '../services/catalog';
import { selectedCampusId, selectCampus } from '../services/selectedCampus';

export function CatalogEntry() {
  const [params, setParams] = useSearchParams();
  const campusId = params.get('campusId') || selectedCampusId();
  return campusId ? <CatalogPage key={campusId} initialCampusId={campusId} onCampusChange={id => setParams({ campusId: id }, { replace: true })} /> : <Navigate to="/campus" replace />;
}

export function CampusPage() {
  const navigate = useNavigate();
  const [campus, setCampus] = useState<Campus[]>();
  const [selected, setSelected] = useState(selectedCampusId);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    void getCampus(controller.signal).then(value => {
      if (!controller.signal.aborted) setCampus(value);
    }).catch(() => { if (!controller.signal.aborted) setError('No pudimos cargar los campus. Inténtalo nuevamente.'); });
    return () => controller.abort();
  }, [attempt]);
  const choice = campus?.find(value => value.id === selected);
  return <section className="campus-page" aria-labelledby="campus-title">
    <div className="campus-intro"><Link to="/">← Volver al inicio</Link><span className="eyebrow">📍 Selección de sede</span>
      <h1 id="campus-title">¿En qué campus estás?</h1><p>Elige tu sede actual para ver los productos y las cafeterías disponibles.</p><BrandArt />
    </div>
    <div className="campus-options">
      {error ? <div role="alert"><p>{error}</p><button className="btn-primary" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>
      : !campus ? <p role="status">Cargando campus…</p>
      : campus.length === 0 ? <p role="status">No hay campus disponibles.</p>
      : <><fieldset><legend className="visually-hidden">Selecciona tu campus</legend>
        {campus.map(value => <label className={`campus-option${selected === value.id ? ' selected' : ''}`} key={value.id}>
          <input type="radio" name="campus" value={value.id} checked={selected === value.id} onChange={() => setSelected(value.id)} />
          <span className="campus-icon" aria-hidden="true">🏛</span><strong>{value.nombre}</strong><span className="campus-check" aria-hidden="true">{selected === value.id ? '✓' : '→'}</span>
        </label>)}
      </fieldset><button className="btn-primary" disabled={!choice} onClick={() => {
        if (!choice) return; selectCampus(choice); navigate(`/catalogo?campusId=${encodeURIComponent(choice.id)}`);
      }}>Continuar al catálogo →</button></>}
    </div>
  </section>;
}
