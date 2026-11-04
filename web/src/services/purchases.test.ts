import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from './httpClient';
import {
  cancelPurchase,
  confirmPurchase,
  createPurchase,
} from './purchases';

vi.mock('./httpClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./httpClient')>();
  return { ...actual, request: vi.fn() };
});

describe('servicio de compras por API Gateway', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });

  it('crea compras enviando solo ofertas y cantidades con clave idempotente', async () => {
    vi.mocked(request).mockResolvedValue({ compraId: 'purchase-1' });
    const items = [{ ofertaId: 'offer-1', cantidad: 2 }];

    await createPurchase(items, 'key-create');

    expect(request).toHaveBeenCalledWith('/v1/compras', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'key-create',
      },
      body: JSON.stringify({ items }),
    });
  });

  it.each([
    ['confirmar', confirmPurchase, '/v1/compras/purchase-1/confirmar'],
    ['cancelar', cancelPurchase, '/v1/compras/purchase-1/cancelar'],
  ] as const)('envía %s sin cuerpo y con clave idempotente', async (_action, action, path) => {
    vi.mocked(request).mockResolvedValue({ compraId: 'purchase-1' });

    await action('purchase-1', 'key-action');

    expect(request).toHaveBeenCalledWith(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'key-action' },
    });
  });
});
