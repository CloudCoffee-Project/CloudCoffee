import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandArt } from './BrandArt';
export function AuthShell({ children, register = false }: { children: ReactNode; register?: boolean }) {
  return <section className="auth-shell"><aside className="auth-brand"><span className="eyebrow">{register ? 'Para la comunidad UCT' : 'Hola de nuevo'}</span><h2>{register ? 'Pide antes, retira sin filas.' : 'Tu café te está esperando.'}</h2><p>Un momento para ti, entre una clase y otra.</p><BrandArt /></aside><div className="auth-form-content"><Link className="back-link" to="/">← Volver</Link>{children}</div></section>;
}
