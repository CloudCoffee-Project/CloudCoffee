// src/services/auth.ts
//
// Servicio de autenticación. Interactúa con el API Gateway:
//   - POST /v1/auth/login  → emite accessToken + refreshToken (INT2-21).
//
// NOTA: el endpoint login del backend está siendo implementado en INT2-21
// (hoy solo existe la ruta pública del gateway, aún sin controller). La forma
// de la respuesta que asumimos: { accessToken, refreshToken }.

import { decodeJwtPayload, httpClient } from './httpClient';
import type { Rol, SesionDecodificada } from '../types/domain';

export interface CredencialesLogin {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

/** Llama a POST /v1/auth/login con las credenciales del usuario. */
export async function login(credenciales: CredencialesLogin): Promise<LoginResponse> {
  const response = await httpClient.post<LoginResponse>('/v1/auth/login', {
    email: credenciales.email.trim().toLowerCase(),
    password: credenciales.password,
  });

  return response.data;
}

// DTO exacto que espera POST /v1/auth/register (RegistroClienteRequest).
export interface RegistroClienteRequest {
  email: string;
  password: string;
  nombre: string;
  apellido: string;
  telefono: string;
}

export interface RegistroClienteResponse {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  telefono: string;
  rol: string;
  verificado: boolean;
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
