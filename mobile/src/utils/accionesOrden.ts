// src/utils/accionesOrden.ts
//
// Traducción única de las respuestas de las dos acciones del cajero que cambian
// el estado de una orden (INT4-103): confirmar entrega y resolver no retirados.
// El servicio propaga el ApiError normalizado del httpClient; acá se convierte
// en un mensaje claro para la pantalla y se decide si la respuesta del backend
// realmente confirma el cambio. Ninguna rama inventa un resultado cuando la
// petición falló o cuando la respuesta no trae el estado esperado.

import { toApiError } from '../services/httpClient';
import type { Orden } from '../types/domain';
import { esEstadoOrden } from '../types/domain';

export type AccionOrdenCajero = 'entrega' | 'no_retirado';

const SIN_CAMBIO = 'No se registró ningún cambio.';

// El backend no confirmó la transición: la pantalla no debe mostrar éxito.
export const MENSAJE_SIN_CONFIRMACION =
  'El backend no confirmó el cambio de estado. No se muestra un resultado registrado.';

function nombreAccion(accion: AccionOrdenCajero): string {
  return accion === 'entrega' ? 'la entrega' : 'la revisión';
}

function mensajePorCodigo(codigo: string, accion: AccionOrdenCajero): string | undefined {
  switch (codigo) {
    case 'QR_INVALIDO':
      return `El código QR no es válido para esta orden. ${SIN_CAMBIO}`;
    case 'QR_UTILIZADO':
      return 'Este código QR ya fue utilizado. La entrega ya estaba registrada; no se registró una nueva.';
    case 'QR_VENCIDO':
      return 'El código QR venció. Pide al cliente un código vigente; no se registró la entrega.';
    case 'ESTADO_INVALIDO':
      return accion === 'entrega'
        ? `La orden no está lista para retiro o ya cambió de estado. ${SIN_CAMBIO}`
        : `La orden ya no está pendiente de revisión. ${SIN_CAMBIO}`;
    case 'IDEMPOTENCY_CONFLICT':
      return `La solicitud entró en conflicto con una operación anterior. ${SIN_CAMBIO}`;
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'La operación todavía está en curso. No se registró un nuevo resultado; vuelve a consultar en unos segundos.';
    case 'OPERACION_PENDIENTE':
      return `El backend no pudo confirmar el resultado. Vuelve a consultar la orden antes de reintentar; ${SIN_CAMBIO.toLowerCase()}`;
    case 'RUTA_NO_DISPONIBLE':
      return accion === 'no_retirado'
        ? `La resolución de órdenes no retiradas todavía no está disponible en el backend. ${SIN_CAMBIO}`
        : `La entrega todavía no está disponible en el backend. ${SIN_CAMBIO}`;
    default:
      return undefined;
  }
}

/**
 * Mensaje de error normalizado para una acción del cajero. Prioriza el `code`
 * del problem+json (QR_* / IDEMPOTENCY_* / ESTADO_INVALIDO) y después el status;
 * el detail del backend se usa solo como último recurso y siempre se explica
 * que no se registró ningún cambio.
 */
export function mensajeErrorAccionOrden(error: unknown, accion: AccionOrdenCajero): string {
  const apiError = toApiError(error as never);
  const porCodigo = apiError.problem?.code
    ? mensajePorCodigo(apiError.problem.code, accion)
    : undefined;
  if (porCodigo) {
    return porCodigo;
  }

  switch (apiError.status) {
    case 0:
      return `No se pudo conectar con el servidor. No se pudo registrar ${nombreAccion(
        accion
      )}; revisa tu conexión e inténtalo de nuevo.`;
    case 401:
      return `Tu sesión expiró. Vuelve a iniciar sesión; ${SIN_CAMBIO.toLowerCase()}`;
    case 403:
      return `Tu usuario no tiene permisos para esta cafetería. ${SIN_CAMBIO}`;
    case 404:
      return `No encontramos la orden en tu cafetería. ${SIN_CAMBIO}`;
    case 503:
      return `El servicio no está disponible en este momento. No se pudo registrar ${nombreAccion(
        accion
      )}; inténtalo de nuevo.`;
    default:
      break;
  }

  const detalle = apiError.message.trim();
  // axios/armado de tests: "Request failed with status code 409" no es un
  // mensaje útil para la cajera; en ese caso se usa el texto de acción.
  if (!detalle || /^Request failed with status code \d+$/.test(detalle)) {
    return `No se pudo registrar ${nombreAccion(accion)}. ${SIN_CAMBIO}`;
  }
  return `${detalle} ${SIN_CAMBIO}`;
}

export interface ResultadoAccionOrden {
  orden: Orden;
  mensaje: string;
}

// Validación en runtime: las pantallas trabajan con Orden tipada, pero una
// respuesta inesperada (proxy, HTML, DTO incompleto) no puede convertirse en un
// "resultado registrado" falso.
function esOrden(valor: unknown): valor is Orden {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const candidato = valor as Record<string, unknown>;
  return (
    typeof candidato.ordenId === 'string' &&
    candidato.ordenId.length > 0 &&
    typeof candidato.codigoOrden === 'string' &&
    candidato.codigoOrden.length > 0 &&
    esEstadoOrden(candidato.estado)
  );
}

/** Solo considera registrada la entrega si el backend devolvió `entregado`. */
export function resultadoEntrega(respuesta: unknown): ResultadoAccionOrden | null {
  if (!esOrden(respuesta) || respuesta.estado !== 'entregado') {
    return null;
  }
  return {
    orden: respuesta,
    mensaje: `Entrega registrada: orden ${respuesta.codigoOrden} (${respuesta.ordenId}) quedó entregada.`,
  };
}

/**
 * Solo considera registrada la revisión si el backend devolvió
 * `no_retirado_final`. No afirma reingresos/descartes por ítem: el contrato
 * dice que esa especificación es de una issue posterior.
 */
export function resultadoNoRetirado(respuesta: unknown): ResultadoAccionOrden | null {
  if (!esOrden(respuesta) || respuesta.estado !== 'no_retirado_final') {
    return null;
  }
  return {
    orden: respuesta,
    mensaje: `Revisión registrada: orden ${respuesta.codigoOrden} (${respuesta.ordenId}) quedó con resolución final.`,
  };
}
