import { useEffect, useState } from 'react';
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
  const url = src || (resolved?.id === productId ? resolved?.src : null);
  return url && failed !== url
    ? <img className={`product-thumbnail ${className}`} src={url} alt={name} loading="lazy" onError={() => setFailed(url)} />
    : <span className={`product-thumbnail product-thumbnail-empty ${className}`} role="img" aria-label={`Sin foto de ${name}`}>☕</span>;
}
