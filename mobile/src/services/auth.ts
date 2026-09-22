// src/services/auth.ts
//
// Servicio de autenticación. Interactúa con el API Gateway:
//   - POST /v1/auth/login             → emite accessToken + refreshToken (INT2-21).
//   - POST /v1/auth/register          → crea cuenta de cliente y dispara verificación.
//   - POST /v1/auth/verificacion      → confirma el correo con el token recibido.
//   - POST /v1/auth/verificacion/reenviar → emite un token de verificación nuevo.
//   - POST /v1/auth/password/recovery → solicita recuperar la contraseña (INT2-21-bis).
//   - POST /v1/auth/password/reset    → restablece la contraseña con el token del correo.
//
// NOTA: los endpoints de login y recuperación del backend están siendo
// implementados en INT2-21. Hoy solo existen sus rutas públicas en el
// gateway, así que las formas de request/response que asumimos acá siguen el
// patrón del resto del contrato.

import { decodeJwtPayload, httpClient } from './httpClient';
import type {
  CredencialesLogin,
  LoginResponse,
  RegistroClienteRequest,
  RegistroClienteResponse,
  RestablecerPasswordRequest,
  Rol,
  SesionDecodificada,
  VerificarCorreoResponse,
} from '../types/domain';

/** Llama a POST /v1/auth/login con las credenciales del usuario. */
export async function login(credenciales: CredencialesLogin): Promise<LoginResponse> {
  const response = await httpClient.post<LoginResponse>('/v1/auth/login', {
    email: credenciales.email.trim().toLowerCase(),
    password: credenciales.password,
  });

  return response.data;
}

/** Llama a POST /v1/auth/register y crea la cuenta del cliente. */
export async function registrar(datos: RegistroClienteRequest): Promise<RegistroClienteResponse> {
  const response = await httpClient.post<RegistroClienteResponse>('/v1/auth/register', {
    email: datos.email.trim().toLowerCase(),
    password: datos.password,
    nombre: datos.nombre.trim(),
    apellido: datos.apellido.trim(),
    telefono: datos.telefono.trim(),
  });

  return response.data;
}

/** Llama a POST /v1/auth/verificacion con el token que llegó por correo. */
export async function verificarCorreo(token: string): Promise<VerificarCorreoResponse> {
  const response = await httpClient.post<VerificarCorreoResponse>('/v1/auth/verificacion', {
    token: token.trim(),
  });

  return response.data;
}

/** Llama a POST /v1/auth/verificacion/reenviar para que el backend emita un token nuevo. */
export async function reenviarVerificacion(email: string): Promise<void> {
  await httpClient.post('/v1/auth/verificacion/reenviar', {
    email: email.trim().toLowerCase(),
  });
}

/** Llama a POST /v1/auth/password/recovery y solicita el enlace de restablecimiento. */
export async function solicitarRecuperacion(email: string): Promise<void> {
  await httpClient.post('/v1/auth/password/recovery', {
    email: email.trim().toLowerCase(),
  });
}

/** Llama a POST /v1/auth/password/reset con el token del correo y la clave nueva. */
export async function restablecerPassword(token: string, nuevaPassword: string): Promise<void> {
  const body: RestablecerPasswordRequest = {
    token: token.trim(),
    nuevaPassword,
  };
  await httpClient.post('/v1/auth/password/reset', body);
}

// Mapea el rol del backend (CLIENTE, CAJERO, ADMIN_CAFETERIA, SUPER_ADMIN)
// al union type Rol de la app. Ante un rol desconocido asume 'cliente'.
export function mapearRol(rol: unknown): Rol {
  switch (String(rol).toUpperCase()) {
    case 'CAJERO':
      return 'cajero';
    case 'ADMIN_CAFETERIA':
    case 'ADMIN':
      return 'admin_cafeteria';
    case 'SUPER_ADMIN':
      return 'super_admin';
    case 'CLIENTE':
    case 'CLIENT':
    case 'CONSUMIDOR':
    default:
      return 'cliente';
  }
}

// Construye la sesión a partir del JWT emitido por el backend. Asume el
// payload: { sub, userId, rol, cafeteriaId, exp }. Devuelve null si el token
// no se puede decodificar o no trae rol.
export function decodificarSesion(accessToken: string): SesionDecodificada | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) {
    return null;
  }

  const rol = mapearRol(payload.rol ?? payload.role ?? payload.tipo);
  const userId = String(payload.userId ?? payload.sub ?? '');
  const exp = typeof payload.exp === 'number' ? payload.exp : 0;

  if (!userId) {
    return null;
  }

  return {
    userId,
    rol,
    cafeteriaId: payload.cafeteriaId ? String(payload.cafeteriaId) : null,
    exp,
  };
}
