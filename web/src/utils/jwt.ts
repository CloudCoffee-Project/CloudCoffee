export type UserRole = 'CLIENTE' | 'CAJERO' | 'ADMIN_CAFETERIA' | 'SUPER_ADMIN';

export interface DecodedSession {
  userId: string;
  role: UserRole;
  cafeteriaId: string | null;
  exp: number;
}

const VALID_ROLES: ReadonlySet<UserRole> = new Set([
  'CLIENTE',
  'CAJERO',
  'ADMIN_CAFETERIA',
  'SUPER_ADMIN',
]);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && VALID_ROLES.has(value as UserRole);
}

function decodeBase64Url(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    const binary = atob(normalized + '='.repeat(padding));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Extrae los claims públicos del JWT solo para navegación y UI en el cliente.
 * La autorización real se aplica siempre en el API Gateway y microservicios.
 */
export function decodeSessionToken(token: string | null | undefined): DecodedSession | null {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  const jsonPayload = decodeBase64Url(parts[1]);
  if (!jsonPayload) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(jsonPayload);
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const claims = payload as Record<string, unknown>;
  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  const role = claims.role;
  const exp = typeof claims.exp === 'number' ? claims.exp : null;

  if (!sub || !isUserRole(role) || exp === null) {
    return null;
  }

  // Verificar que el token no haya expirado (exp está en segundos UNIX)
  if (exp * 1000 <= Date.now()) {
    return null;
  }

  const cafeteriaId =
    typeof claims.cafeteriaId === 'string' && claims.cafeteriaId.trim()
      ? claims.cafeteriaId.trim()
      : null;

  return {
    userId: sub,
    role,
    cafeteriaId,
    exp,
  };
}