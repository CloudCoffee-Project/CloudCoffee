// src/services/auth.ts
//
// Servicio de autenticación. Interactúa con el API Gateway:
//   - POST /v1/auth/login             → emite accessToken + refreshToken (INT2-21).
//   - POST /v1/auth/register          → crea cuenta de cliente y dispara verificación.
//   - POST /v1/auth/verificacion      → confirma el correo con el token recibido.
//   - POST /v1/auth/verificacion/reenviar → emite un token de verificación nuevo.
//   - POST /v1/auth/password/recovery → solicita recuperar la contraseña (INT2-21-bis).
//   - POST /v1/auth/password/reset    → restablece la contraseña con el token del correo.
//   - POST /v1/auth/password/change   → cambia la contraseña estando autenticado (INT4-24).
//   - GET  /v1/auth/me                → perfil del usuario autenticado (INT4-23).
//   - PUT  /v1/auth/me                → actualiza nombre/apellido/teléfono (INT4-23).
//
// NOTA: los endpoints de login y recuperación del backend están siendo
// implementados en INT2-21. Hoy solo existen sus rutas públicas en el
// gateway, así que las formas de request/response que asumimos acá siguen el
// patrón del resto del contrato. Lo mismo ocurre con los endpoints de perfil
// (INT4-23): el gateway ya enruta /v1/auth/**, pero el auth-service todavía no
// expone el controller, así que hoy devolverían 404 hasta que el backend lo
// implemente; los tipos se definen en domain.ts siguiendo la entidad Usuario
// (mismo shape que RegistroClienteResponse).

import { decodeJwtPayload, httpClient } from './httpClient';
import type {
  ActualizarPerfilRequest,
  CambiarContrasenaRequest,
  CredencialesLogin,
  LoginResponse,
  PerfilUsuario,
  RegistroClienteRequest,
  RegistroClienteResponse,
  RestablecerPasswordRequest,
  Rol,
  SesionDecodificada,
  VerificarCorreoResponse,
} from '../types/domain';

// Ruta canónica de los endpoints de perfil propio. GET devuelve el
// PerfilUsuario y PUT lo actualiza (contrato a implementar en el auth-service).
export const PERFIL_ENDPOINT = '/v1/auth/me';

// Llama a GET /v1/auth/me y devuelve los datos del usuario autenticado.
export async function obtenerPerfil(): Promise<PerfilUsuario> {
  const response = await httpClient.get<PerfilUsuario>(PERFIL_ENDPOINT);

  return response.data;
}

// Llama a PUT /v1/auth/me actualizando nombre, apellido y teléfono. Devuelve
// el perfil persistido por el backend.
export async function actualizarPerfil(datos: ActualizarPerfilRequest): Promise<PerfilUsuario> {
  const response = await httpClient.put<PerfilUsuario>(PERFIL_ENDPOINT, {
    nombre: datos.nombre.trim(),
    apellido: datos.apellido.trim(),
    telefono: datos.telefono.trim(),
  });

  return response.data;
}

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

// Ruta canónica del cambio de contraseña autenticado (INT4-24). Contrato
// pendiente en el auth-service: recibe la contraseña actual + la nueva y
// cambia la clave del usuario autenticado. El gateway ya enruta /v1/auth/**,
// así que hoy devolvería 404 hasta que el backend lo implemente.
export const CAMBIAR_PASSWORD_ENDPOINT = '/v1/auth/password/change';

/** Llama a POST /v1/auth/password/change con la contraseña actual y la nueva. */
export async function cambiarContrasena(datos: CambiarContrasenaRequest): Promise<void> {
  await httpClient.post(CAMBIAR_PASSWORD_ENDPOINT, {
    passwordActual: datos.passwordActual,
    nuevaPassword: datos.nuevaPassword,
  });
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
