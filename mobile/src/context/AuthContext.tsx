// src/context/AuthContext.tsx
//
// Contexto global de sesión (INT4-2). Sustituye la sesión hardcodeada del
// root layout: expone la sesión activa, el estado de bootstrapping (mientras
// se validan los tokens guardados) y las operaciones iniciar/cerrar sesión.
// Los tokens se persisten en AsyncStorage y se inyectan en httpClient.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearTokens, setTokens } from '../services/httpClient';
import { decodificarSesion } from '../services/auth';
import type { LoginResponse, SesionDecodificada } from '../types/domain';

const SESSION_STORAGE_KEY = '@app_sesion_tokens';

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

  // Al arrancar: si hay tokens guardados, restáuralos en httpClient y
  // reconstruye la sesión decodificando el JWT.
  useEffect(() => {
    const restaurarSesion = async (): Promise<void> => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) {
          return;
        }

        const tokens = JSON.parse(raw) as LoginResponse;
        const sesionDecodificada = decodificarSesion(tokens.accessToken);
        if (!sesionDecodificada) {
          await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
          return;
        }

        setTokens(tokens);
        setSesion(sesionDecodificada);
      } catch (error) {
        console.warn('[Auth] No se pudo restaurar la sesión guardada:', error);
        await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
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
      await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(tokens));

      return sesionDecodificada;
    },
    []
  );

  const cerrarSesion = useCallback(async () => {
    clearTokens();
    setSesion(null);
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
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
