// src/services/qrRetiro.ts
//
// Contrato del código QR de retiro (INT4-47 + INT4-8): el cliente lo genera
// (qr-retiro.tsx) codificando el payload QrRetiro (src/types/domain.ts) como
// JSON, y el cajero lo escanea (escaner.tsx) para validar la entrega. Parsear y
// serializar en este único lugar evita que cada pantalla invente su propio
// formato o acepte estados que no existen en el union EstadoOrden.

import { esEstadoOrden } from '../types/domain';
import type { EstadoOrden, QrRetiro } from '../types/domain';

export function serializarQrRetiro(payload: QrRetiro): string {
  return JSON.stringify(payload);
}

// Decodifica y valida el contenido escaneado. Devuelve null si el contenido no
// es el JSON de un QrRetiro (pedido no vacío y estado válido del union).
export function parsearQrRetiro(contenido: string): QrRetiro | null {
  try {
    const crudo = JSON.parse(contenido) as unknown;
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

    return { pedido, estado: candidato.estado as EstadoOrden };
  } catch {
    return null;
  }
}
