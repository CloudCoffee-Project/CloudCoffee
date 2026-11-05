import { request } from './httpClient';

export interface VerificationResponse {
  email: string;
  verificado: boolean;
}

export function verifyEmail(token: string) {
  return request<VerificationResponse>('/v1/auth/verificacion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export function resendVerification(email: string) {
  return request<void>('/v1/auth/verificacion/reenviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}
