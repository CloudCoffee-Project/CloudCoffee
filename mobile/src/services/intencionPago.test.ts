// src/services/intencionPago.test.ts
// INT4-130: la clave Idempotency-Key y el escenario deben sobrevivir a un
// reinicio de la app; sin eso un reintento crearía otro pago (409).
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  generarIdempotencyKey,
  guardarIntencionPago,
  INTENCION_PAGO_STORAGE_KEY,
  leerIntencionPago,
  limpiarIntencionPago,
} from './intencionPago';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

const mockGetItem = AsyncStorage.getItem as unknown as jest.Mock;
const mockSetItem = AsyncStorage.setItem as unknown as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as unknown as jest.Mock;

const CLAVE = '123e4567-e89b-42d3-a456-426614174000';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  mockGetItem.mockClear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
  mockGetItem.mockResolvedValue(null);
});

describe('persistencia de la intención de pago simulado', () => {
  it('guarda y recupera compraId, clave y escenario', async () => {
    const intencion = { compraId: 'cmp-1', idempotencyKey: CLAVE, escenario: 'rechazar' } as const;

    await guardarIntencionPago(intencion);

    expect(mockSetItem).toHaveBeenCalledWith(INTENCION_PAGO_STORAGE_KEY, JSON.stringify(intencion));

    mockGetItem.mockResolvedValue(JSON.stringify(intencion));
    await expect(leerIntencionPago()).resolves.toEqual(intencion);
  });

  it('permite una intención todavía sin compra (escenario configurado)', async () => {
    const intencion = { idempotencyKey: CLAVE, escenario: 'pendiente' } as const;
    mockGetItem.mockResolvedValue(JSON.stringify(intencion));

    await expect(leerIntencionPago()).resolves.toEqual(intencion);
  });

  it('no revive datos ausentes, corruptos ni fuera del contrato', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await expect(leerIntencionPago()).resolves.toBeNull();

    mockGetItem.mockResolvedValueOnce('{no es json');
    await expect(leerIntencionPago()).resolves.toBeNull();

    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ idempotencyKey: 'no-uuid', escenario: 'aprobar' })
    );
    await expect(leerIntencionPago()).resolves.toBeNull();

    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ idempotencyKey: CLAVE, escenario: 'pagar' })
    );
    await expect(leerIntencionPago()).resolves.toBeNull();
  });

  it('borra la intención cuando el pago terminó', async () => {
    await limpiarIntencionPago();

    expect(mockRemoveItem).toHaveBeenCalledWith(INTENCION_PAGO_STORAGE_KEY);
  });

  it('genera UUID v4 para la Idempotency-Key', () => {
    expect(generarIdempotencyKey()).toMatch(UUID_V4);
    expect(generarIdempotencyKey()).not.toBe(generarIdempotencyKey());
  });

  it('INT4-131: tras un timeout la misma clave y escenario sobreviven a la reapertura', async () => {
    const antesDelTimeout = { idempotencyKey: CLAVE, escenario: 'pendiente' } as const;
    await guardarIntencionPago(antesDelTimeout);

    // El timeout ocurre después de crear la compra: se conserva su id con la
    // MISMA clave para que el reintento consulte ese pago y no cree otro.
    const trasElTimeout = { ...antesDelTimeout, compraId: 'cmp-timeout' };
    await guardarIntencionPago(trasElTimeout);

    const escrito = mockSetItem.mock.calls[mockSetItem.mock.calls.length - 1][1];
    mockGetItem.mockResolvedValue(escrito);

    const reabierta = await leerIntencionPago();

    expect(reabierta).toEqual(trasElTimeout);
    expect(reabierta?.idempotencyKey).toBe(CLAVE);
    expect(reabierta?.escenario).toBe('pendiente');
  });
});
