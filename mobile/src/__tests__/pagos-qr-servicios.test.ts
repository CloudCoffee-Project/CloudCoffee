// src/__tests__/pagos-qr-servicios.test.ts
// INT4-128: contrato HTTP del pago simulado, la compra puntual, la orden y su
// QR. Estos tests fijan rutas y payloads para que la app no vuelva a inventar
// un estado ni un código de retiro local.
import { httpClient } from '../services/httpClient';
import { obtenerCompra } from '../services/compras';
import { obtenerOrden, obtenerQrRetiro } from '../services/ordenes';
import { consultarPago, simularPago } from '../services/pagos';

// INT4-130: pagos.ts importa la intención persistida; en Jest AsyncStorage se
// reemplaza por el mock del proyecto (no hay módulo nativo).
jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

jest.mock('../services/httpClient', () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockGet = httpClient.get as unknown as jest.Mock;
const mockPost = httpClient.post as unknown as jest.Mock;

const PAGO = {
  pagoId: 'pago-1',
  compraId: 'cmp-1',
  estado: 'aprobado',
  motivo: 'aprobacion_simulada',
  montoTotal: 1800,
  moneda: 'CLP',
  simulado: true,
  proveedor: 'simulado',
  creadoAt: '2026-01-01T00:00:00Z',
  actualizadoAt: '2026-01-01T00:00:00Z',
  version: 1,
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockResolvedValue({ data: PAGO });
  mockPost.mockResolvedValue({ data: PAGO });
});

describe('servicios de pago simulado y retiro', () => {
  it('simularPago envía el escenario con Idempotency-Key UUID', async () => {
    const resultado = await simularPago('cmp-1', 'rechazar');

    expect(resultado).toEqual(PAGO);
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockPost.mock.calls[0];
    expect(url).toBe('/v1/compras/cmp-1/pago');
    expect(body).toEqual({ escenario: 'rechazar' });
    expect(config.headers['Idempotency-Key']).toMatch(UUID_V4);
  });

  it('INT4-130: simularPago reutiliza la Idempotency-Key de la intención', async () => {
    const clave = '123e4567-e89b-42d3-a456-426614174000';

    await simularPago('cmp-1', 'rechazar', clave);

    const config = mockPost.mock.calls[0][2];
    expect(config.headers['Idempotency-Key']).toBe(clave);
  });

  it('consultarPago lee el estado real del pago', async () => {
    await consultarPago('cmp-1');

    expect(mockGet).toHaveBeenCalledWith('/v1/compras/cmp-1/pago');
  });

  it('obtenerCompra lee la compra puntual con sus órdenes y pago', async () => {
    await obtenerCompra('cmp-1');

    expect(mockGet).toHaveBeenCalledWith('/v1/compras/cmp-1');
  });

  it('obtenerOrden y obtenerQrRetiro usan el ordenId del backend', async () => {
    await obtenerOrden('orden-1');
    await obtenerQrRetiro('orden-1');

    expect(mockGet).toHaveBeenNthCalledWith(1, '/v1/orders/orden-1');
    expect(mockGet).toHaveBeenNthCalledWith(2, '/v1/orders/orden-1/qr');
  });

  it('obtenerQrRetiro devuelve el código sin armar un QR local', async () => {
    const codigo = {
      ordenId: 'orden-1',
      codigo: 'opaco-generado-por-order',
      expiraAt: '2026-01-01T01:00:00Z',
    };
    mockGet.mockResolvedValueOnce({ data: codigo });

    await expect(obtenerQrRetiro('orden-1')).resolves.toEqual(codigo);
    expect(codigo.codigo).toBe('opaco-generado-por-order');
  });
});
