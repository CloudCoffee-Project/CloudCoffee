// src/hooks/useNotificacionesPush.ts
//
// Hook de alto nivel para la integración FCM (INT4-41):
//   - Al montarse, configura el manejador de notificaciones y registra el
//     dispositivo (permisos + canal + token FCM + backend).
//   - Escucha notificaciones recibidas con la app abierta y expone la última.
//   - Al abrir una notificación (toca en la bandeja o mientras corre),
//     invoca `abrirNotificacion` con la ruta interna que trae data.url.
//   - Se desuscribe y limpia todo al desmontar.

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { NotificationResponse } from 'expo-notifications';

import {
  configurarManejadorNotificaciones,
  registrarPush,
  suscribirRoladoDeToken,
  urlDeNotificacion,
} from '../services/notificacionesPush';
import type { EstadoPush } from '../services/notificacionesPush';

// Require diferido: en Expo Go (Android, SDK 53+) importar expo-notifications
// lanza un error y tumbaría el root layout (este hook se usa en _layout). Cuando
// no está disponible, Notifications es null y el hook queda inactivo sin romper.
type NotificationsDeExpo = typeof import('expo-notifications');
const Notifications: NotificationsDeExpo | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch (error) {
    console.warn('[push] expo-notifications no disponible en este entorno:', error);
    return null;
  }
})();

export interface NotificacionRecibida {
  titulo: string | undefined;
  cuerpo: string | undefined;
  url: string | null;
}

// Abre la ruta interna cuando el usuario toca una notificación (acción
// "default"); ignora respuestas de acciones custom y notificaciones sin URL.
function procesarApertura(
  respuesta: NotificationResponse,
  abrir: ((url: string) => void) | undefined
): void {
  if (!abrir || respuesta.actionIdentifier !== Notifications?.DEFAULT_ACTION_IDENTIFIER) {
    return;
  }

  const data = (respuesta.notification.request.content.data ?? {}) as Record<string, unknown>;
  const url = urlDeNotificacion(data);
  if (url) {
    abrir(url);
  }
}

export function useNotificacionesPush(
  abrirNotificacion?: (url: string) => void,
  debeRegistrarse: boolean = true
): { estado: EstadoPush; ultimaNotificacion: NotificacionRecibida | null } {
  const [estado, setEstado] = useState<EstadoPush>({ permiso: false, token: null, mensaje: null });
  const [ultimaNotificacion, setUltimaNotificacion] = useState<NotificacionRecibida | null>(null);

  // Configuración global + listeners. Se re-suscribe si cambia el callback de
  // apertura (p. ej. cuando inicia sesión y ya se puede navegar).
  useEffect(() => {
    configurarManejadorNotificaciones();
    if (Platform.OS === 'web' || !Notifications) {
      return;
    }

    let activo = true;

    // Arranque en frío: la app se abrió tocando una notificación.
    void Notifications.getLastNotificationResponseAsync().then((respuesta) => {
      if (activo && respuesta) {
        procesarApertura(respuesta, abrirNotificacion);
      }
    });

    const listenerRecibida = Notifications.addNotificationReceivedListener((notificacion) => {
      if (!activo) {
        return;
      }
      const content = notificacion.request.content;
      setUltimaNotificacion({
        titulo: content.title ?? undefined,
        cuerpo: content.body ?? undefined,
        url: urlDeNotificacion((content.data ?? {}) as Record<string, unknown>),
      });
    });

    const listenerRespuesta = Notifications.addNotificationResponseReceivedListener((respuesta) => {
      procesarApertura(respuesta, abrirNotificacion);
    });

    const quitarRolado = suscribirRoladoDeToken((token) => {
      if (activo) {
        setEstado((previo) => ({ ...previo, token }));
      }
    });

    return () => {
      activo = false;
      listenerRecibida.remove();
      listenerRespuesta.remove();
      quitarRolado();
    };
  }, [abrirNotificacion]);

  // Registro del dispositivo (permisos + canal + token FCM + backend).
  // Solo corre cuando hay sesión activa; si la sesión llega después, al
  // cambiar debeRegistrarse a true el efecto se reejecuta.
  useEffect(() => {
    if (Platform.OS === 'web' || !debeRegistrarse) {
      return;
    }

    let activo = true;
    void registrarPush().then((nuevoEstado) => {
      if (activo) {
        setEstado(nuevoEstado);
      }
    });

    return () => {
      activo = false;
    };
  }, [debeRegistrarse]);

  return { estado, ultimaNotificacion };
}
