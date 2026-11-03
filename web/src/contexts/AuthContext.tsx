import { createContext, useState, useEffect, ReactNode } from 'react';
import { decodeSessionToken, DecodedSession, UserRole } from '../utils/jwt';
import {
  AUTH_SESSION_EVENT,
  clearSessionTokens,
  refreshSession,
  saveSessionTokens,
} from '../services/httpClient';

interface AuthContextType {
  isLoggedIn: boolean;
  isLoading: boolean;
  role: UserRole | null;
  userId: string | null;
  cafeteriaId: string | null;
  login: (accessToken: string, refreshToken?: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readStoredSession(): DecodedSession | null {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      return null;
    }
    const session = decodeSessionToken(token);
    if (!session) {
      localStorage.removeItem?.('accessToken');
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function hasRefreshToken(): boolean {
  try {
    return Boolean(localStorage.getItem('refreshToken')?.trim());
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DecodedSession | null>(() => readStoredSession());
  const [isLoading, setIsLoading] = useState<boolean>(() => !readStoredSession() && hasRefreshToken());

  useEffect(() => {
    let active = true;

    const syncSessionState = () => {
      if (!active) return;
      setSession(readStoredSession());
    };

    window.addEventListener(AUTH_SESSION_EVENT, syncSessionState);
    window.addEventListener('storage', syncSessionState);

    // Criterio INT2-93: Si no hay JWT vigente pero sí refresh token, intentar recuperar sesión
    if (!readStoredSession() && hasRefreshToken()) {
      setIsLoading(true);
      void refreshSession().finally(() => {
        if (!active) return;
        const recovered = readStoredSession();
        if (!recovered) {
          clearSessionTokens();
        }
        setSession(recovered);
        setIsLoading(false);
      });
    }

    return () => {
      active = false;
      window.removeEventListener(AUTH_SESSION_EVENT, syncSessionState);
      window.removeEventListener('storage', syncSessionState);
    };
  }, []);

  const login = (accessToken: string, refreshToken?: string) => {
    const decoded = decodeSessionToken(accessToken);
    if (!decoded) {
      clearSessionTokens();
      setSession(null);
      return;
    }
    saveSessionTokens(accessToken, refreshToken);
    setSession(decoded);
  };

  const logout = () => {
    clearSessionTokens();
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn: session !== null,
        isLoading,
        role: session?.role ?? null,
        userId: session?.userId ?? null,
        cafeteriaId: session?.cafeteriaId ?? null,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}