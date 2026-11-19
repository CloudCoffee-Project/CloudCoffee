// src/services/qrRetiro.ts
//
// Contrato del código QR de retiro (INT4-47 + INT4-8/INT4-103): el QR emitido
// por Order contiene exactamente el token opaco de 43 caracteres Base64URL
// (CodigoRetiro), nunca un JSON con id/estado. Este módulo es el único lugar
// que decide si el contenido escaneado es ese token o el JSON legacy del
// mockup, para que el cajero no acepte un QR que el backend rechazaría.

import { esCodigoRetiroValido, esEstadoOrden } from '../types/domain';
import type { EstadoOrden, QrRetiro } from '../types/domain';

/** true si el contenido escaneado es el token opaco del contrato. */
export function esQrCodigoOpaco(contenido: string): boolean {
  return esCodigoRetiroValido(contenido.trim());
}

/**
 * Serializa el QR con el mismo sobre que ya usa el mockup (`pedido`/`estado`)
 * y agrega `codigo` cuando Order entregó el token. El QR no es el token puro:
 * el escáner necesita el id de la orden para llegar a /entregar; el token viaja
 * como campo opaco y es el backend quien lo valida contra esa orden. Sin
 * `codigo` el QR queda marcado como no válido para entrega.
 */
export function serializarQrRetiro(payload: QrRetiro): string {
  return JSON.stringify({
    pedido: payload.pedido,
    estado: payload.estado,
    ...(payload.codigo ? { codigo: payload.codigo } : {}),
  });
}

/**
 * Decodifica y valida el contenido escaneado. El token opaco no codifica la
 * orden, así que se devuelve con `pedido` vacío: el escáner no puede navegar a
 * la confirmación sin antes haber validado el retiro contra el backend.
 */
export function parsearQrRetiro(contenido: string): QrRetiro | null {
  const limpio = contenido.trim();
  if (!limpio) {
    return null;
  }

  if (esQrCodigoOpaco(limpio)) {
    return { pedido: '', estado: 'listo_para_retiro', codigo: limpio };
  }

  try {
    const crudo = JSON.parse(limpio) as unknown;
    if (typeof crudo !== 'object' || crudo === null) {
      return null;
    }

    const candidato = crudo as Record<string, unknown>;
    const pedido = candidato.pedido;
    if (typeof pedido !== 'string' || pedido.trim().length === 0) {
      return null;
    }

    if (!esEstadoOrden(candidato.estado)) {
      return null;
    }

    const codigo = candidato.codigo;
    if (codigo !== undefined && !esCodigoRetiroValido(codigo)) {
      return null;
    }

    return {
      pedido,
      estado: candidato.estado as EstadoOrden,
      ...(codigo ? { codigo } : {}),
    };
  } catch {
    return null;
  }
}
