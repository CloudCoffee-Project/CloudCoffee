import { request } from './httpClient';

export function requestPasswordRecovery(email: string) {
  return request<void>('/v1/auth/password/recovery', {
    method: 'POST',
    omitAccessToken: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, nuevaPassword: string) {
  return request<void>('/v1/auth/password/reset', {
    method: 'POST',
    omitAccessToken: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, nuevaPassword }),
  });
}
