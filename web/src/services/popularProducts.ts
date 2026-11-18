import { getProductById, getProductOffers, type ProductDetail } from './catalog';
import { request } from './httpClient';
export async function getPopularProducts(campusId: string, signal: AbortSignal): Promise<ProductDetail[]> {
  const ranking = await request<{ productoId: string; cantidad: number }[]>('/v1/orders/productos-populares', { signal, omitAccessToken: true });
  const products = await Promise.all(ranking.map(async ({ productoId }) => {
    try {
      const product = await getProductById(productoId, signal);
      if (campusId) {
        const offers = await getProductOffers(productoId, campusId, signal);
        if (!offers.some(offer => offer.disponible && offer.stock > 0)) return null;
      }
      return product;
    } catch (cause) {
      if (signal.aborted) throw cause;
      // An archived or unavailable product must not break the other slides.
      return null;
    }
  }));
  return products.filter((product): product is ProductDetail => product !== null);
}
