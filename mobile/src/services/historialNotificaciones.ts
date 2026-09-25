// src/services/historialNotificaciones.ts
//
// Bandeja local de notificaciones push recibidas (INT4-43). Persiste en
// AsyncStorage un historial acotado (las 30 más recientes) con título, cuerpo,
// URL interna opcional y estado leída/no leída, independiente de la sesión:
// al cerrar sesión se borra el token FCM (eliminarRegistroPush) pero la
// bandeja se conserva (es del dispositivo, no del usuario).

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Notification } from 'expo-notifications';

import { urlDeNotificacion } from './notificacionesPush';

export interface NotificacionHistorial {
  id: string;
  titulo: string;
  cuerpo: string;
  url: string | null;
  leida: boolean;
  fechaIso: string;
}

const HISTORIAL_STORAGE_KEY = '@app_notificaciones_historial';
const MAX_HISTORIAL = 30;

// Convierte una Notification de expo-notifications al registro de la bandeja.
// Devuelve null para notificaciones "data-only" (sin título ni cuerpo): no
// tienen contenido legible y no deben ensuciar la bandeja.
export function paraHistorial(notificacion: Notification): NotificacionHistorial | null {
  const content = notificacion.request.content;
  const titulo = content.title?.trim() ?? '';
  const cuerpo = content.body?.trim() ?? '';
  if (!titulo && !cuerpo) {
    return null;
  }

  const fechaMs = typeof notificacion.date === 'number' ? notificacion.date : Date.now();
  return {
    id: notificacion.request.identifier || `n-${fechaMs}`,
    titulo,
    cuerpo,
    url: urlDeNotificacion((content.data ?? {}) as Record<string, unknown>),
    leida: false,
    fechaIso: new Date(fechaMs).toISOString(),
  };
}

// Devuelve el historial persistido (más reciente primero). Nunca lanza: si el
// almacenamiento está vacío o corrupto devuelve una lista vacía.
export async function listarNotificaciones(): Promise<NotificacionHistorial[]> {
  try {
    const crudo = await AsyncStorage.getItem(HISTORIAL_STORAGE_KEY);
    if (!crudo) {
      return [];
    }
    const parseado: unknown = JSON.parse(crudo);
    if (!Array.isArray(parseado)) {
      return [];
    }
    return parseado as NotificacionHistorial[];
  } catch {
    return [];
  }
}

async function guardarHistorial(historial: NotificacionHistorial[]): Promise<void> {
  await AsyncStorage.setItem(HISTORIAL_STORAGE_KEY, JSON.stringify(historial));
}

// Agrega una notificación al inicio (dedupe por id) y acota el historial a las
// MAX_HISTORIAL más recientes. Devuelve la lista resultante.
export async function agregarNotificacion(
  entrada: NotificacionHistorial
): Promise<NotificacionHistorial[]> {
  const actual = await listarNotificaciones();
  const sinDuplicado = actual.filter((n) => n.id !== entrada.id);
  const historial = [{ ...entrada }, ...sinDuplicado].slice(0, MAX_HISTORIAL);
  await guardarHistorial(historial);
  return historial;
}

export async function marcarLeida(id: string): Promise<NotificacionHistorial[]> {
  const actual = await listarNotificaciones();
  const historial = actual.map((n) => (n.id === id ? { ...n, leida: true } : n));
  await guardarHistorial(historial);
  return historial;
}

export async function marcarTodasLeidas(): Promise<NotificacionHistorial[]> {
  const actual = await listarNotificaciones();
  const historial = actual.map((n) => (n.leida ? n : { ...n, leida: true }));
  await guardarHistorial(historial);
  return historial;
}

export async function contarNoLeidas(): Promise<number> {
  const historial = await listarNotificaciones();
  return historial.filter((n) => !n.leida).length;
}

export async function vaciarHistorial(): Promise<void> {
  await AsyncStorage.removeItem(HISTORIAL_STORAGE_KEY);
}
