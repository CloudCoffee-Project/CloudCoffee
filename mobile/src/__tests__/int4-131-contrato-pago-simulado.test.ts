// src/__tests__/int4-131-contrato-pago-simulado.test.ts
//
// INT4-131: pruebas del CONTRATO del pago simulado de Order con el httpClient
// real (adapter de axios controlado), no con un serve de servicios. Así se
// comprueban a la vez la ruta, el cuerpo, la Idempotency-Key, el Bearer, los
// Problem Details (RFC 9457) y que el resultado viene del backend: la app no
// fabrica estados, no necesita initPoint y nunca abre un navegador de pago.
//
// Referencia: backend/docs/compra-pago-retiro.md ("Idempotencia y concurrencia"
// y "Pago simulado") y compra-pago-retiro.openapi.json (SimularPago).
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import * as WebBrowser from 'expo-web-browser';

import { ApiError, clearTokens, httpClient, setTokens } from '../services/httpClient';
import type { ApiProblem } from '../services/httpClient';
import { consultarPago, simularPago } from '../services/pagos';
import type { EscenarioPago, EstadoPago, MotivoPago, Pago } from '../types/domain';

// pagos.ts importa la intención persistida: en Jest se usa el mock del proyecto.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => jest.requireActual('../test-utils').asyncStorageMock
);

// El recorrido actual NO usa WebBrowser. El espía demuestra que ninguna rama
// del contrato simulado vuelve al checkout de Mercado Pago.
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'cancel' })),
}));

const COMPRA_ID = 'compra-int4-131';
const CLAVE = '3f2b1c4d-5e6a-4b78-9c0d-1e2f3a4b5c6d'; // UUID v4 de la intención
const OTRA_CLAVE = 'a1b2c3d4-e5f6-4a78-8b90-1c2d3e4f5a6b';
const TOKEN = 'jwt-de-prueba-int4-131';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ESCENARIOS: readonly {
  escenario: EscenarioPago;
  estado: EstadoPago;
  motivo: MotivoPago;
}[] = [
  { escenario: 'aprobar', estado: 'aprobado', motivo: 'aprobacion_simulada' },
  { escenario: 'rechazar', estado: 'rechazado', motivo: 'rechazo_simulado' },
  { escenario: 'pendiente', estado: 'pendiente', motivo: 'escenario_pendiente' },
];

function pagoDelBackend(estado: EstadoPago, motivo: MotivoPago): Pago {
  return {
    pagoId: 'pago-int4-131',
    compraId: COMPRA_ID,
    estado,
    motivo,
    montoTotal: 1800,
    moneda: 'CLP',
    simulado: true,
    proveedor: 'simulado',
    creadoAt: '2026-01-01T00:00:00Z',
    actualizadoAt: '2026-01-01T00:00:00Z',
    version: 1,
  };
}

interface LlamadaHttp {
  metodo: string;
  url: string;
  autorizacion?: string;
  idempotencyKey?: string;
  cuerpo: unknown;
}

type Respuesta = { data: unknown; status: number };

function cabecera(config: InternalAxiosRequestConfig, nombre: string): string | undefined {
  const valor = config.headers.get(nombre);
  return valor === undefined ? undefined : String(valor);
}

let llamadas: LlamadaHttp[] = [];
let comportamiento: (config: InternalAxiosRequestConfig) => Respuesta;

const adapter: AxiosAdapter = async (config) => {
  const peticion = config as InternalAxiosRequestConfig;
  const cuerpoCrudo = peticion.data;
  llamadas.push({
    metodo: (peticion.method ?? 'get').toUpperCase(),
    url: `${peticion.baseURL ?? ''}${peticion.url ?? ''}`,
    autorizacion: cabecera(peticion, 'Authorization'),
    idempotencyKey: cabecera(peticion, 'Idempotency-Key'),
    cuerpo: typeof cuerpoCrudo === 'string' ? JSON.parse(cuerpoCrudo) : cuerpoCrudo,
  });

  const { data, status } = comportamiento(peticion);
  return { data, status, statusText: '', headers: {}, config: peticion };
};

function problem(status: number, code: string, detail: string): ApiProblem {
  return {
    type: 'about:blank',
    title: 'Conflicto con el pago simulado',
    status,
    detail,
    instance: `/v1/compras/${COMPRA_ID}/pago`,
    timestamp: '2026-01-01T00:00:00Z',
    code,
    traceId: 'trace-int4-131',
  };
}

function responderConProblema(
  config: InternalAxiosRequestConfig,
  status: number,
  code: string,
  detail: string
): never {
  throw new AxiosError(
    detail,
    String(status),
    config,
    {},
    {
      data: problem(status, code, detail),
      status,
      statusText: '',
      headers: {},
      config,
    }
  );
}

function respuestaPorDefecto(config: InternalAxiosRequestConfig): Respuesta {
  if ((config.method ?? 'get').toLowerCase() === 'get') {
    // GET /pago: estado ya existente, sin cobrar ni cambiar nada.
    return { data: pagoDelBackend('pendiente', 'escenario_pendiente'), status: 200 };
  }

  const cuerpo = (typeof config.data === 'string' ? JSON.parse(config.data) : config.data) as {
    escenario: EscenarioPago;
  };
  const definicion = ESCENARIOS.find((item) => item.escenario === cuerpo.escenario);
  if (!definicion) {
    return responderConProblema(config, 400, 'ESCENARIO_INVALIDO', 'Escenario no soportado');
  }

  // El comando crea el recurso con 201 incluso si el estado es pendiente.
  return {
    data: pagoDelBackend(definicion.estado, definicion.motivo),
    status: 201,
  };
}

describe('INT4-131: contrato del pago simulado de Order', () => {
  let adapterOriginal: typeof httpClient.defaults.adapter;

  beforeEach(() => {
    adapterOriginal = httpClient.defaults.adapter;
    httpClient.defaults.adapter = adapter as AxiosAdapter;
    llamadas = [];
    comportamiento = respuestaPorDefecto;
    setTokens({ accessToken: TOKEN });
  });

  afterEach(() => {
    httpClient.defaults.adapter = adapterOriginal;
    clearTokens();
    jest.clearAllMocks();
  });

  it.each(ESCENARIOS)(
    'el escenario $escenario produce el estado $estado que decide Order',
    async ({ escenario, estado, motivo }) => {
      const pago = await simularPago(COMPRA_ID, escenario, CLAVE);

      expect(pago.estado).toBe(estado);
      expect(pago.motivo).toBe(motivo);
      expect(pago.simulado).toBe(true);
      expect(pago.proveedor).toBe('simulado');
      expect(pago).not.toHaveProperty('initPoint');

      expect(llamadas).toHaveLength(1);
      expect(llamadas[0].metodo).toBe('POST');
      expect(llamadas[0].url).toContain(`/v1/compras/${COMPRA_ID}/pago`);
      expect(llamadas[0].cuerpo).toEqual({ escenario });
      expect(llamadas[0].idempotencyKey).toBe(CLAVE);
      expect(llamadas[0].autorizacion).toBe(`Bearer ${TOKEN}`);
      expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
    }
  );

  it('la Idempotency-Key es un UUID v4 que el reintento NO cambia', async () => {
    await simularPago(COMPRA_ID, 'pendiente', CLAVE);
    await simularPago(COMPRA_ID, 'pendiente', CLAVE);

    expect(CLAVE).toMatch(UUID_V4);
    expect(llamadas.map((llamada) => llamada.idempotencyKey)).toEqual([CLAVE, CLAVE]);
    expect(llamadas.map((llamada) => llamada.cuerpo)).toEqual([
      { escenario: 'pendiente' },
      { escenario: 'pendiente' },
    ]);
  });

  it('otra clave sobre el mismo pago responde 409 PAGO_YA_INICIADO', async () => {
    comportamiento = (config) => {
      if (cabecera(config, 'Idempotency-Key') === CLAVE) {
        return respuestaPorDefecto(config);
      }
      return responderConProblema(
        config,
        409,
        'PAGO_YA_INICIADO',
        'La compra ya tiene un pago iniciado.'
      );
    };

    expect(OTRA_CLAVE).toMatch(UUID_V4);
    await expect(simularPago(COMPRA_ID, 'aprobar', OTRA_CLAVE)).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'La compra ya tiene un pago iniciado.',
    });
    expect(llamadas[0].idempotencyKey).toBe(OTRA_CLAVE);
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('sin pago previo responde 404 PAGO_NO_ENCONTRADO normalizado', async () => {
    comportamiento = (config) =>
      responderConProblema(config, 404, 'PAGO_NO_ENCONTRADO', 'La compra aún no tiene pago.');

    expect.assertions(5);
    try {
      await consultarPago(COMPRA_ID);
    } catch (thrown) {
      const error = thrown as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(404);
      expect(error.message).toBe('La compra aún no tiene pago.');
      expect(error.problem?.code).toBe('PAGO_NO_ENCONTRADO');
      expect(error.problem?.instance).toBe(`/v1/compras/${COMPRA_ID}/pago`);
    }
  });

  it('con pago existente devuelve el estado real con Authorization y sin Idempotency-Key', async () => {
    comportamiento = () => ({
      data: pagoDelBackend('rechazado', 'rechazo_simulado'),
      status: 200,
    });

    const pago = await consultarPago(COMPRA_ID);

    expect(pago.estado).toBe('rechazado');
    expect(pago.pagoId).toBe('pago-int4-131');
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].metodo).toBe('GET');
    expect(llamadas[0].url).toContain(`/v1/compras/${COMPRA_ID}/pago`);
    expect(llamadas[0].autorizacion).toBe(`Bearer ${TOKEN}`);
    expect(llamadas[0].idempotencyKey).toBeUndefined();
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('la consulta del resultado viaja autorizada con el token de la sesión', async () => {
    setTokens({ accessToken: 'token-rotado-int4-131' });

    await consultarPago(COMPRA_ID);

    expect(llamadas[0].autorizacion).toBe('Bearer token-rotado-int4-131');
    clearTokens();

    llamadas = [];
    await consultarPago(COMPRA_ID);

    // Sin sesión el interceptor no inventa un Bearer vacío.
    expect(llamadas[0].autorizacion).toBeUndefined();
  });

  it('normaliza los Problem Details de conflicto y operación pendiente', async () => {
    const casos = [
      {
        status: 409,
        code: 'IDEMPOTENCY_CONFLICT',
        detail: 'La misma clave ya se usó con otro cuerpo.',
      },
      {
        status: 503,
        code: 'OPERACION_PENDIENTE',
        detail: 'La operación sigue en curso; reconsulte el resultado.',
      },
    ];

    expect.assertions(casos.length);
    for (const caso of casos) {
      comportamiento = (config) =>
        responderConProblema(config, caso.status, caso.code, caso.detail);

      await expect(simularPago(COMPRA_ID, 'aprobar', CLAVE)).rejects.toMatchObject({
        name: 'ApiError',
        status: caso.status,
        message: caso.detail,
        problem: expect.objectContaining({
          code: caso.code,
          traceId: 'trace-int4-131',
          timestamp: '2026-01-01T00:00:00Z',
        }),
      });
    }
  });

  it('un error de red al simular no confirma ningún pago ni abre navegador', async () => {
    comportamiento = (config) => {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    };

    await expect(simularPago(COMPRA_ID, 'aprobar', CLAVE)).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'Network Error',
    });

    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('un timeout al consultar deja el estado desconocido, no un aprobado fabricado', async () => {
    comportamiento = (config) => {
      throw new AxiosError('timeout', 'ECONNABORTED', config);
    };

    await expect(consultarPago(COMPRA_ID)).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: 'timeout',
    });
    expect(llamadas[0].metodo).toBe('GET');
  });
});
