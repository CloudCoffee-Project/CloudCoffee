// src/services/sessionStorage.ts
//
// Almacenamiento seguro de la sesión (INT4-22). Los tokens de acceso y de
// refresh se guardan cifrados con SecureStore (Keychain en iOS, Keystore +
// SharedPreferences en Android). Cada token vive en su propia clave para no
// superar el límite de ~2048 bytes que algunas versiones de iOS aplican a un
// valor del keychain.

import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = '@app_sesion_access_token';
const REFRESH_TOKEN_KEY = '@app_sesion_refresh_token';

export interface SesionGuardada {
  accessToken: string;
  refreshToken: string;
}

/** Persiste el par de tokens en SecureStore (Keychain/Keystore). */
export async function guardarSesion(tokens: SesionGuardada): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

/** Lee el par de tokens guardado. Devuelve null si falta alguno de los dos. */
export async function leerSesion(): Promise<SesionGuardada | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);

  if (!accessToken || !refreshToken) {
    return null;
  }

  return { accessToken, refreshToken };
}

/** Elimina el par de tokens de SecureStore. */
export async function eliminarSesion(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}
