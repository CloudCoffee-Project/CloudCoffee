// src/services/intencionPago.ts
//
// INT4-130: persistencia local de la INTENCIÓN del pago simulado de Order.
//
// El contrato (backend/docs/compra-pago-retiro.openapi.json) exige una
// Idempotency-Key UUID por intención: repetir la misma clave con el mismo
// escenario reproduce la primera respuesta, pero usar otra clave cuando la
// compra ya tiene pago responde 409 PAGO_YA_INICIADO. La BD tampoco guarda el
// escenario elegido (solo estado y motivo), así que la app necesita conservar
// clave + escenario + compraId para que reabrir o reintentar no cree otro pago
// ni cambie lo que el usuario pidió simular.
//
// No es un secreto del usuario: se guarda en AsyncStorage, igual que el campus
// o el historial de notificaciones. Los tokens siguen en SecureStore
// (services/sessionStorage.ts).

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { EscenarioPago } from '../types/domain';

/** Clave única del almacén: una sola intención activa a la vez (un checkout). */
export const INTENCION_PAGO_STORAGE_KEY = '@cloudcoffee:intencion-pago';

const ESCENARIOS: readonly EscenarioPago[] = ['aprobar', 'rechazar', 'pendiente'];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IntencionPago {
  /** Compra ya creada en Order. Vacía si el usuario aún no confirmó. */
  compraId?: string;
  /** Se envía como Idempotency-Key en POST /v1/compras/{compraId}/pago. */
  idempotencyKey: string;
  /** Decisión del usuario; Order decide después el EstadoPago real. */
  escenario: EscenarioPago;
}

/** UUID v4 para Idempotency-Key (antes vivía dentro de services/pagos.ts). */
export function generarIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function esEscenarioPago(valor: unknown): valor is EscenarioPago {
  return typeof valor === 'string' && (ESCENARIOS as readonly string[]).includes(valor);
}

function esIntencionValida(valor: unknown): valor is IntencionPago {
  if (!valor || typeof valor !== 'object') {
    return false;
  }

  const candidato = valor as Partial<IntencionPago>;
  const compraIdValida =
    candidato.compraId === undefined ||
    (typeof candidato.compraId === 'string' && candidato.compraId.length > 0);

  return (
    compraIdValida &&
    typeof candidato.idempotencyKey === 'string' &&
    UUID_V4.test(candidato.idempotencyKey) &&
    esEscenarioPago(candidato.escenario)
  );
}

/**
 * Lee la intención guardada. Un dato ausente, corrupto o de una versión
 * anterior se trata como "no hay intención": nunca se envía una clave inválida
 * al backend ni se revive un escenario que la app ya no conoce.
 */
export async function leerIntencionPago(): Promise<IntencionPago | null> {
  try {
    const crudo = await AsyncStorage.getItem(INTENCION_PAGO_STORAGE_KEY);
    if (!crudo) {
      return null;
    }

    const parseado: unknown = JSON.parse(crudo);
    return esIntencionValida(parseado) ? parseado : null;
  } catch {
    return null;
  }
}

/** Guarda (o actualiza) la intención activa. */
export async function guardarIntencionPago(intencion: IntencionPago): Promise<void> {
  await AsyncStorage.setItem(INTENCION_PAGO_STORAGE_KEY, JSON.stringify(intencion));
}

/** Cierra la intención: el pago terminó o se inició una compra nueva. */
export async function limpiarIntencionPago(): Promise<void> {
  await AsyncStorage.removeItem(INTENCION_PAGO_STORAGE_KEY);
}
