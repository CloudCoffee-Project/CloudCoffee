import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../services/httpClient';
import { listImageProducts, productImageUrl, uploadProductImage, type ImagePage } from '../services/productImages';
export function ProductImageManager() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ImagePage | null>(null);
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const upload = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setData(null); setSelected(''); setFile(null);
    void listImageProducts(page, controller.signal).then(value => {
      if (!controller.signal.aborted) { setData(value); setSelected(value.content[0]?.id ?? ''); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof ApiRequestError ? cause.detail : 'No se pudieron cargar los productos.'); });
    return () => controller.abort();
  }, [page, retry]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !file || !selected) return;
    setError(''); setMessage('');
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0) { setError('Selecciona una imagen JPEG o PNG de hasta 5 MB.'); return; }
    upload.current = new AbortController(); const signal = upload.current.signal; setBusy(true);
    try {
      const updated = await uploadProductImage(selected, file, signal);
      if (!signal.aborted) { setData(old => old ? { ...old, content: old.content.map(p => p.id === updated.id ? updated : p) } : old); setMessage('Imagen guardada correctamente.'); setFile(null); if (input.current) input.current.value = ''; }
    } catch (cause) { if (!signal.aborted) setError(cause instanceof ApiRequestError ? cause.detail : 'No se pudo guardar la imagen. Inténtalo nuevamente.'); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  const product = data?.content.find(p => p.id === selected);
  return <section className="image-manager" aria-labelledby="image-manager-title">
    <h2 id="image-manager-title">Imágenes de productos</h2><p>Selecciona un producto existente y carga su fotografía. JPEG o PNG, hasta 5 MB.</p>
    {error && <p role="alert">{error}</p>}
    {!data ? error ? <button className="btn-primary" onClick={() => setRetry(v => v + 1)}>Reintentar imágenes</button> : <p role="status">Cargando productos…</p> : data.content.length === 0 ? <p>No hay productos en esta página.</p> : <>
      <form onSubmit={event => void submit(event)}>
        <label>Producto<select aria-label="Producto para imagen" value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setMessage(''); }}>{data.content.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
        {product?.imagenUrl && <img className="image-manager-preview" src={productImageUrl(product.imagenUrl)} alt={`Imagen actual de ${product.nombre}`} />}
        <label>Fotografía<input ref={input} type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setMessage(''); }} /></label>
        <button className="btn-primary" disabled={busy || !file || !selected}>{busy ? 'Guardando imagen…' : 'Guardar imagen'}</button>
      </form>
      {data.totalPages > 1 && <nav aria-label="Páginas de productos para imágenes"><button disabled={page === 0 || busy} onClick={() => setPage(p => p - 1)}>Anterior</button><button disabled={page + 1 >= data.totalPages || busy} onClick={() => setPage(p => p + 1)}>Siguiente</button></nav>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
