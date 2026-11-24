import { beforeEach, expect, it, vi } from 'vitest';
import { getPopularProducts } from './popularProducts';
import { request } from './httpClient';
import { getProductById, getProductOffers } from './catalog';
vi.mock('./httpClient', () => ({ request:vi.fn() }));
vi.mock('./catalog', () => ({ getProductById:vi.fn(), getProductOffers:vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it('mantiene el ranking del servidor y excluye productos retirados', async () => {
  vi.mocked(request).mockResolvedValue([{productoId:'cafe',cantidad:12},{productoId:'te',cantidad:8},{productoId:'retirado',cantidad:2}]);
  vi.mocked(getProductById).mockImplementation(async id => { if(id === 'retirado') throw new Error('404'); return {id,nombre:id,imagenUrl:null,descripcion:null,categoria:{id:'b',nombre:'Bebidas'}}; });
  const result = await getPopularProducts('',new AbortController().signal);
  expect(result.map(p=>p.id)).toEqual(['cafe','te']);
  expect(request).toHaveBeenCalledWith('/v1/orders/productos-populares',expect.objectContaining({omitAccessToken:true}));
});
it('solo ofrece los favoritos disponibles en el campus elegido', async () => {
  vi.mocked(request).mockResolvedValue([{productoId:'sin-stock',cantidad:10},{productoId:'cafe',cantidad:2}]);
  vi.mocked(getProductById).mockImplementation(async id=>({id,nombre:id,imagenUrl:null,descripcion:null,categoria:{id:'b',nombre:'Bebidas'}}));
  vi.mocked(getProductOffers).mockImplementation(async id=>id === 'cafe' ? [{id:'o',cafeteriaId:'c',cafeteriaName:'Central',price:1500,stock:2,disponible:true}] : []);
  expect((await getPopularProducts('campus',new AbortController().signal)).map(p=>p.id)).toEqual(['cafe']);
});
