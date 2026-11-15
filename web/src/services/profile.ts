import { request } from './httpClient';
import type { UserRole } from '../utils/jwt';

export interface Profile {
  id: string;
  email: string;
  nombre: string | null;
  apellido: string | null;
  telefono: string | null;
  rol: UserRole;
}

export interface ProfileChanges {
  nombre?: string;
  apellido?: string;
  telefono?: string;
}

export function getProfile(signal: AbortSignal) {
  return request<Profile>('/v1/auth/users/me', { signal });
}

export function updateProfile(changes: ProfileChanges, signal: AbortSignal) {
  return request<Profile>('/v1/auth/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
    signal,
  });
}

export function changePassword(passwordActual: string, passwordNueva: string, signal: AbortSignal) {
  return request<void>('/v1/auth/users/me/password', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passwordActual, passwordNueva }),
    signal,
  });
}
