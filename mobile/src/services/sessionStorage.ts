// src/services/sessionStorage.ts
//
// Almacenamiento seguro de la sesión (INT4-22). Los tokens de acceso y de
// refresh se guardan cifrados con SecureStore (Keychain en iOS, Keystore +
// SharedPreferences en Android). Cada token vive en su propia clave para no
// superar el límite de ~2048 bytes que algunas versiones de iOS aplican a un
// valor del keychain.
//
// En web SecureStore no existe (es una API de Keychain/Keystore), así que se
// usa localStorage como respaldo para que la app corro también en el
// navegador durante el desarrollo.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// SecureStore solo acepta claves con caracteres alfanuméricos, ".", "-" y "_"
// (un "@" como el de AsyncStorage tira "Invalid key provided to SecureStore").
const ACCESS_TOKEN_KEY = 'app.sesion.access_token';
const REFRESH_TOKEN_KEY = 'app.sesion.refresh_token';

// Claves viejas (con "@") inválidas para SecureStore; se limpian en el primer
// arranque para no dejar sesiones huérfanas guardadas antes de la corrección.
const ACCESS_TOKEN_KEY_VIEJO = '@app_sesion_access_token';
const REFRESH_TOKEN_KEY_VIEJO = '@app_sesion_refresh_token';

export interface SesionGuardada {
  accessToken: string;
  refreshToken: string;
}

function guardarEnWeb(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // localStorage puede no estar disponible (modo privado/embebido).
  }
}

function leerEnWeb(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function eliminarEnWeb(clave: string): void {
  try {
    localStorage.removeItem(clave);
  } catch {
    // Sin tratamiento: la sesión ya no existe igual.
  }
}

/** Persiste el par de tokens en SecureStore (Keychain/Keystore). */
export async function guardarSesion(tokens: SesionGuardada): Promise<void> {
  if (Platform.OS === 'web') {
    guardarEnWeb(ACCESS_TOKEN_KEY, tokens.accessToken);
    guardarEnWeb(REFRESH_TOKEN_KEY, tokens.refreshToken);
    return;
  }
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

/** Lee el par de tokens guardado. Devuelve null si falta alguno de los dos. */
export async function leerSesion(): Promise<SesionGuardada | null> {
  if (Platform.OS === 'web') {
    const accessToken = leerEnWeb(ACCESS_TOKEN_KEY);
    const refreshToken = leerEnWeb(REFRESH_TOKEN_KEY);
    return accessToken && refreshToken ? { accessToken, refreshToken } : null;
  }
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  ]);

  if (!accessToken || !refreshToken) {
    return null;
  }

  return { accessToken, refreshToken };
}

/** Elimina el par de tokens de SecureStore (nunca lanza: la limpieza no debe
 *  romper el arranque ni el cierre de sesión). */
export async function eliminarSesion(): Promise<void> {
  const claves = [
    ACCESS_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    ACCESS_TOKEN_KEY_VIEJO,
    REFRESH_TOKEN_KEY_VIEJO,
  ];

  if (Platform.OS === 'web') {
    claves.forEach((clave) => eliminarEnWeb(clave));
    return;
  }

  await Promise.all(
    claves.map(async (clave) => {
      try {
        await SecureStore.deleteItemAsync(clave);
      } catch (error) {
        // Una clave inválida o ausente no debe romper la limpieza.
        console.warn(`[sessionStorage] No se pudo eliminar la clave ${clave}:`, error);
      }
    })
  );
}
