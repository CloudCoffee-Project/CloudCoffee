import { createContext, useState, ReactNode } from 'react';
import { decodeSessionToken, DecodedSession, UserRole } from '../utils/jwt';

interface AuthContextType {
  isLoggedIn: boolean;
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
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DecodedSession | null>(() => readStoredSession());

  const login = (accessToken: string, refreshToken?: string) => {
    const decoded = decodeSessionToken(accessToken);
    if (!decoded) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      setSession(null);
      return;
    }
    localStorage.setItem('accessToken', accessToken);
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken);
    }
    setSession(decoded);
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn: session !== null,
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