// src/context/AuthContext.tsx
//
// Contexto global de sesión (INT4-2). Sustituye la sesión hardcodeada del
// root layout: expone la sesión activa, el estado de bootstrapping (mientras
// se validan los tokens guardados) y las operaciones iniciar/cerrar sesión.
// Los tokens se persisten en SecureStore (Keychain/Keystore) mediante
// sessionStorage (INT4-22) y se inyectan en httpClient.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { clearTokens, getRefreshToken, onTokensCambiados, setTokens } from '../services/httpClient';
import { decodificarSesion, logout } from '../services/auth';
import { eliminarSesion, guardarSesion, leerSesion } from '../services/sessionStorage';
import { eliminarRegistroPush } from '../services/notificacionesPush';
import type { LoginResponse, SesionDecodificada } from '../types/domain';

interface AuthContextValue {
  sesion: SesionDecodificada | null;
  bootstrapping: boolean;
  iniciarSesion: (tokens: LoginResponse) => Promise<SesionDecodificada | null>;
  cerrarSesion: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Cierra la sesión en el backend (INT4-25) sin dejar que una falla de red
// deje al usuario atrapado en la app.
//
// El revoke es "mejor esfuerzo" a propósito: si el servidor no responde, la
// sesión local se cierra igual y los tokens se borran del dispositivo. Lo que
// se pierde en ese caso es la revocación en el servidor, que queda cubierta por
// dos cosas del contrato: el accessToken caduca corto y el refreshToken rota en
// cada renovación, así que un token robado sirve para una sola renovación y no
// para una sesión nueva. Preferimos una sesión cerrada con la revocación
// pendiente antes que un botón que no hace nada porque la red se cayó.
async function revocarSesionEnBackend(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return;
  }

  try {
    await logout(refreshToken);
  } catch (error) {
    console.warn('[Auth] No se pudo revocar la sesión en el backend:', error);
  }
}

interface Props {
  children: ReactNode;
}

export function AuthProvider({ children }: Props) {
  const [sesion, setSesion] = useState<SesionDecodificada | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  // Mantiene persistida la sesión cada vez que cambian los tokens en memoria:
  // cubre el login y también los tokens renovados por el refresh (INT4-22).
  useEffect(() => {
    onTokensCambiados((tokens) => {
      if (tokens) {
        void guardarSesion(tokens);
      } else {
        void eliminarSesion();
      }
    });
  }, []);

  // Al arrancar: si hay tokens guardados en SecureStore, restáuralos en
  // httpClient y reconstruye la sesión decodificando el JWT del acceso.
  useEffect(() => {
    const restaurarSesion = async (): Promise<void> => {
      try {
        const tokens = await leerSesion();
        if (!tokens) {
          return;
        }

        const sesionDecodificada = decodificarSesion(tokens.accessToken);
        if (!sesionDecodificada) {
          await eliminarSesion();
          return;
        }

        setTokens(tokens);
        setSesion(sesionDecodificada);
      } catch (error) {
        console.warn('[Auth] No se pudo restaurar la sesión guardada:', error);
        await eliminarSesion();
        clearTokens();
      } finally {
        setBootstrapping(false);
      }
    };

    void restaurarSesion();
  }, []);

  const iniciarSesion = useCallback(
    async (tokens: LoginResponse): Promise<SesionDecodificada | null> => {
      const sesionDecodificada = decodificarSesion(tokens.accessToken);
      if (!sesionDecodificada) {
        return null;
      }

      setTokens(tokens);

      setSesion(sesionDecodificada);

      return sesionDecodificada;
    },
    []
  );

  const cerrarSesion = useCallback(async () => {
    // Revoca la sesión en el backend (INT4-25) antes de tocar nada en el
    // dispositivo: POST /v1/auth/logout necesita el refreshToken en el body y el
    // accessToken en el header Bearer, y ninguno de los dos sobrevive a
    // clearTokens(). El mismo orden aplica al DELETE del token push (INT4-42).
    await revocarSesionEnBackend();
    await eliminarRegistroPush();
    clearTokens();
    setSesion(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ sesion, bootstrapping, iniciarSesion, cerrarSesion }),
    [sesion, bootstrapping, iniciarSesion, cerrarSesion]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un <AuthProvider>');
  }
  return context;
}
