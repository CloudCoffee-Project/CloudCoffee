// src/services/auth.ts
//
// Servicio de autenticación. Interactúa con el API Gateway:
//   - POST /v1/auth/login             → emite accessToken + refreshToken (INT2-21).
//   - POST /v1/auth/register          → crea cuenta de cliente y dispara verificación.
//   - POST /v1/auth/verificacion      → confirma el correo con el token recibido.
//   - POST /v1/auth/verificacion/reenviar → emite un token de verificación nuevo.
//   - POST /v1/auth/password/recovery → solicita recuperar la contraseña (INT2-21-bis).
//   - POST /v1/auth/logout            → revoca el refreshToken de la sesión (INT4-25).
//   - GET  /v1/auth/users/me         → perfil del usuario autenticado (INT4-23).
//   - PATCH /v1/auth/users/me        → actualiza nombre/apellido/teléfono (INT4-23).
//   - PATCH /v1/auth/users/me/password → cambia la contraseña (INT4-24).
//
// NOTA: login, registro, verificación, recuperación y logout ya responden en el
// auth-service. Los de perfil (INT4-23/24) tienen el contrato de `UserController`
// de origin/main: viven bajo /v1/auth/users y el verbo de edición es PATCH, no
// PUT. Quedan 404 por el gateway porque el controller se mapea a /v1/auth/users
// mientras el gateway aplica StripPrefix=1 y le entrega /auth/users;AuthController
// sí usa /auth y por eso ese funciona. Es un bug de backend: cuando se corrija el
// prefijo, estas llamadas conectan sin tocar la app. Detalle en
// docs/contratos-backend.md.

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

// Rutas de perfil propio según `UserController` (INT4-23/24). El prefijo /v1 es el
// que espera el gateway; internamente el servicio lo recibe sin él por el
// StripPrefix=1, así que el mapeo del controller debería quedar en /auth/users.
export const PERFIL_ENDPOINT = '/v1/auth/users/me';

// Cambio de contraseña autenticado (INT4-24), mismo controller.
export const CAMBIAR_PASSWORD_ENDPOINT = '/v1/auth/users/me/password';

// Llama a GET /v1/auth/users/me y devuelve los datos del usuario autenticado.
export async function obtenerPerfil(): Promise<PerfilUsuario> {
  const response = await httpClient.get<PerfilUsuario>(PERFIL_ENDPOINT);

  return response.data;
}

// Llama a PATCH /v1/auth/users/me actualizando nombre, apellido y teléfono.
// El verbo es PATCH: UserController no mapea PUT, que responde 405.
export async function actualizarPerfil(datos: ActualizarPerfilRequest): Promise<PerfilUsuario> {
  const response = await httpClient.patch<PerfilUsuario>(PERFIL_ENDPOINT, {
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

/**
 * Cambia la contraseña del usuario autenticado (INT4-24).
 *
 * PATCH y no POST: `UserController` mapea `@PatchMapping("/me/password")` sobre
 * `/v1/auth/users`, así que el verbo correcto es PATCH.
 *
 * El campo de la nueva contraseña es `passwordNueva`, que es como lo llama
 * `ChangePasswordRequest`. Mandar `nuevaPassword` —el nombre que usa la app en
 * su formulario— da 400 pidiendo `passwordNueva`, así que el body se traduce
 * acá y no en la pantalla.
 */
export async function cambiarContrasena(datos: CambiarContrasenaRequest): Promise<void> {
  await httpClient.patch(CAMBIAR_PASSWORD_ENDPOINT, {
    passwordActual: datos.passwordActual,
    passwordNueva: datos.nuevaPassword,
  });
}

// Ruta canónica del cierre de sesión (INT4-25). El auth-service la implementa:
// revoca el refreshToken de la sesión y responde 204 sin cuerpo.
export const LOGOUT_ENDPOINT = '/v1/auth/logout';

/**
 * Revoca la sesión en el backend (INT4-25).
 *
 * El refreshToken va en el body y el accessToken viaja en el header
 * `Authorization: Bearer`, que pone el interceptor del httpClient por lo mismo
 * que en el resto de las llamadas: acá no se arma a mano.
 *
 * Es la mitad del cierre de sesión que ocurre en el servidor. La otra mitad
 * (olvidar los tokens en el dispositivo) la hace AuthContext.cerrarSesion,
 * siempre después de esta llamada: si se limpuran antes, el refreshToken ya no
 * está ni en memoria ni en SecureStore y no hay nada que revocar.
 */
export async function logout(refreshToken: string): Promise<void> {
  await httpClient.post(LOGOUT_ENDPOINT, { refreshToken });
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
