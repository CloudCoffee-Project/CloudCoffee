// src/utils/avisarAdministrador.ts
//
// Acción "avisar al administrador" de la pantalla del cajero sin cafetería
// (INT4-96). No inventa un endpoint nuevo: el gateway solo rutea
// /v1/auth, /v1/catalog y /v1/notifications, así que el aviso sale por la vía
// disponible en el dispositivo, la app de correo, con un asunto y un cuerpo ya
// redactados para que el cajero no tenga que explicar el problema.
//
// El texto se arma con una función pura (mensajeAvisoAdministrador) para poder
// testearlo sin abrir el cliente de correo.

import * as Linking from 'expo-linking';

import { ADMIN_EMAIL } from '../config/soporte';

/** Asunto del correo de aviso al administrador. */
export const ASUNTO_AVISO_ADMIN = 'Cajero sin cafetería asignada en CloudCoffee';

/**
 * Cuerpo del correo que el cajero envía al administrador. Incluye el dominio
 * de la app y el correo del cajero para que el administrador pueda ubicar la
 * cuenta (el JWT no expone el email; ver SesionDecodificada en types/domain).
 */
export function mensajeAvisoAdministrador(emailCajero?: string | null): string {
  const lineas = [
    'Hola,',
    '',
    'Soy cajero de CloudCoffee y mi cuenta no tiene una cafetería asignada, así que no puedo operar el punto de venta.',
    '¿Podrían asignarme una cafetería? Necesito cerrar la sesión y volver a entrar para que mi sesión tome la asignación.',
    '',
    'Gracias.',
  ];

  if (emailCajero) {
    lineas.push('', `Mi cuenta es: ${emailCajero}`);
  }

  return lineas.join('\n');
}

/**
 * Abre la app de correo con el aviso ya redactado. Devuelve true si el
 * dispositivo pudo abrir el cliente de correo.
 */
export async function avisarAlAdministrador(emailCajero?: string | null): Promise<boolean> {
  const url = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(
    ASUNTO_AVISO_ADMIN
  )}&body=${encodeURIComponent(mensajeAvisoAdministrador(emailCajero))}`;

  return Linking.openURL(url);
}
