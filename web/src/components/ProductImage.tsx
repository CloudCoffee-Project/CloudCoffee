import { useEffect, useState } from 'react';
import { env } from '../config/env';
import { getProductById } from '../services/catalog';

// Existing carts and historical order snapshots may predate product images.
export function ProductImage({ productId, src, name, className = '' }: {
  productId?: string; src?: string | null; name: string; className?: string;
}) {
  const [resolved, setResolved] = useState<{ id?: string; src: string | null }>();
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    if (src || !productId) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => getProductById(productId, controller.signal)).then(product => {
      if (!controller.signal.aborted) setResolved({ id: productId, src: product.imagenUrl });
    }).catch(() => {});
    return () => controller.abort();
  }, [productId, src]);
  const value = src || (resolved?.id === productId ? resolved?.src : null);
  const url = value?.startsWith('/v1/catalog/imagenes/') && env.apiBaseUrl
    ? new URL(value, env.apiBaseUrl).href : value;
  return url && failed !== url
    ? <img className={`product-thumbnail ${className}`} src={url} alt={name} loading="lazy" onError={() => setFailed(url)} />
    : <span className={`product-thumbnail product-thumbnail-empty ${className}`} role="img" aria-label={`Sin foto de ${name}`}>☕</span>;
}
