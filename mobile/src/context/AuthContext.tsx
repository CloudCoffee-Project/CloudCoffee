// src/context/AuthContext.tsx
//
// Contexto global de sesión (INT4-2). Sustituye la sesión hardcodeada del
// root layout: expone la sesión activa, el estado de bootstrapping (mientras
// se validan los tokens guardados) y las operaciones iniciar/cerrar sesión.
// Los tokens se persisten en SecureStore (Keychain/Keystore) mediante
// sessionStorage (INT4-22) y se inyectan en httpClient.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { clearTokens, onTokensCambiados, setTokens } from '../services/httpClient';
import { decodificarSesion } from '../services/auth';
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
    // Elimina el token push del backend ANTES de limpiar los tokens de auth
    // (INT4-42): así el DELETE viaja con el Authorization Bearer vigente.
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
