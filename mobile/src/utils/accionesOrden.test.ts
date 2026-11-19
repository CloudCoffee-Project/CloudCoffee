// src/utils/accionesOrden.test.ts
import { ApiError } from '../services/httpClient';
import type { ApiProblem } from '../services/httpClient';
import type { Orden } from '../types/domain';
import {
  MENSAJE_SIN_CONFIRMACION,
  mensajeErrorAccionOrden,
  resultadoEntrega,
  resultadoNoRetirado,
} from './accionesOrden';

function problema(status: number, code?: string, detail = 'Detalle del backend'): ApiProblem {
  return {
    type: 'about:blank',
    title: 'Error HTTP',
    status,
    detail,
    instance: '/v1/orders/o-1/entregar',
    timestamp: '2026-11-19T12:00:00Z',
    ...(code ? { code } : {}),
  };
}

const orden: Orden = {
  ordenId: 'o-1',
  codigoOrden: 'CC-9801',
  cafeteriaId: 'c-1',
  cafeteriaNombre: 'Cafetería Central',
  estado: 'listo_para_retiro',
  montoTotal: 4300,
  items: [],
};

describe('mensajeErrorAccionOrden', () => {
  it('prioriza el code del problem+json sobre el detail', () => {
    const error = new ApiError('Detalle del backend', 409, problema(409, 'QR_UTILIZADO'));

    expect(mensajeErrorAccionOrden(error, 'entrega')).toContain('ya fue utilizado');
    expect(mensajeErrorAccionOrden(error, 'entrega')).not.toContain('Detalle del backend');
  });

  it('adapta ESTADO_INVALIDO a la acción que falló', () => {
    const error = new ApiError('Conflicto', 409, problema(409, 'ESTADO_INVALIDO'));

    expect(mensajeErrorAccionOrden(error, 'entrega')).toContain('no está lista para retiro');
    expect(mensajeErrorAccionOrden(error, 'no_retirado')).toContain(
      'ya no está pendiente de revisión'
    );
  });

  it('explica la degradación cuando el backend no expone la ruta', () => {
    const error = new ApiError('Not Found', 404, problema(404, 'RUTA_NO_DISPONIBLE'));

    expect(mensajeErrorAccionOrden(error, 'no_retirado')).toContain(
      'todavía no está disponible en el backend'
    );
    expect(mensajeErrorAccionOrden(error, 'no_retirado')).toContain('No se registró ningún cambio');
  });

  it('da un mensaje claro para red caída, sesión y permisos', () => {
    expect(mensajeErrorAccionOrden(new ApiError('Network Error', 0), 'entrega')).toContain(
      'No se pudo conectar'
    );
    expect(mensajeErrorAccionOrden(new ApiError('Unauthorized', 401), 'entrega')).toContain(
      'sesión expiró'
    );
    expect(mensajeErrorAccionOrden(new ApiError('Forbidden', 403), 'entrega')).toContain(
      'permisos'
    );
  });

  it('no muestra el detail crudo de axios como mensaje final', () => {
    // Un 409 con problem+json vacío llega al httpClient como ApiError(409) con
    // message de axios. La pantalla no debe mostrar ese texto técnico.
    expect(
      mensajeErrorAccionOrden(new ApiError('Request failed with status code 409', 409), 'entrega')
    ).toBe('No se pudo registrar la entrega. No se registró ningún cambio.');
  });

  it('conserva el detail del backend cuando no hay code ni status conocido', () => {
    const error = new ApiError('La cafetería está cerrada', 400, problema(400));

    expect(mensajeErrorAccionOrden(error, 'entrega')).toContain('La cafetería está cerrada');
    expect(mensajeErrorAccionOrden(error, 'entrega')).toContain('No se registró ningún cambio');
  });
});

describe('resultados de acciones del cajero', () => {
  it('solo registra la entrega si la respuesta dice entregado', () => {
    expect(resultadoEntrega(orden)).toBeNull();
    expect(resultadoEntrega({ ...orden, estado: 'pagado' })).toBeNull();
    expect(resultadoEntrega({ ordenId: 'o-1' })).toBeNull();

    const registrada = resultadoEntrega({ ...orden, estado: 'entregado' });
    expect(registrada?.mensaje).toContain('CC-9801');
    expect(registrada?.mensaje).toContain('entregada');
  });

  it('solo registra la revisión si la respuesta dice no_retirado_final', () => {
    expect(resultadoNoRetirado(orden)).toBeNull();

    const registrada = resultadoNoRetirado({ ...orden, estado: 'no_retirado_final' });
    expect(registrada?.mensaje).toContain('CC-9801');
    expect(registrada?.mensaje).toContain('resolución final');
    expect(registrada?.mensaje).not.toContain('reingresado');
  });

  it('expone el mensaje de respuesta sin confirmación para las pantallas', () => {
    expect(MENSAJE_SIN_CONFIRMACION).toContain('No se muestra un resultado registrado');
  });
});
