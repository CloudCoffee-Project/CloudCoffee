// src/services/notificacionesPush.ts
//
// Integración de Firebase Cloud Messaging (FCM) para notificaciones push
// (INT4-41) usando expo-notifications (SDK 57).
//
// En Android, expo-notifications usa FCM bajo el capó: getDevicePushTokenAsync()
// devuelve el token FCM nativo del dispositivo. En iOS devuelve el token APNs.
//
// Flujo de uso:
//   1. configurarManejadorNotificaciones()  → una vez, al arrancar la app,
//      para que las notificaciones se muestren con la app en primer plano.
//   2. registrarPush()  → pide permisos, crea el canal Android, obtiene el
//      token FCM, lo persiste en AsyncStorage y lo registra en el backend.
//   3. suscribirRoladoDeToken()  → reacciona si FCM rota el token en caliente
//      (el token viejo deja de ser válido y el nuevo debe re-registrarse).
//   4. eliminarRegistroPush()    → al cerrar sesión (INT4-42): borra el token
//      en el backend y limpia el almacenamiento local.
//
// NOTA: las notificaciones push remotas requieren un development build; en
// Expo Go (Android, SDK 53+) no están disponibles. Además, en Android el push
// usa el proyecto Firebase del archivo google-services.json; hasta que el
// equipo lo agregue, obtener el token puede fallar y se reporta sin romper.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { httpClient } from './httpClient';

// Canal Android donde se muestran las notificaciones de pedidos/retiros.
// Debe coincidir con defaultChannel del plugin en app.json.
export const CANAL_PEDIDOS = 'pedidos';

export interface EstadoPush {
  permiso: boolean;
  token: string | null;
  mensaje: string | null;
}

const TOKEN_STORAGE_KEY = '@app_fcm_token';

// Define cómo se presentan las notificaciones cuando la app está en primer
// plano (imperativo llamarlo temprano; setNotificationHandler es global).
export function configurarManejadorNotificaciones(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

// Android 8+ exige un canal por notificación; Android 13+ además pide crear
// al menos un canal ANTES de solicitar el token. Es un no-op en iOS.
export async function crearCanalPedidos(
  onAndroid: boolean = Platform.OS === 'android'
): Promise<void> {
  if (!onAndroid) {
    return;
  }

  await Notifications.setNotificationChannelAsync(CANAL_PEDIDOS, {
    name: 'Pedidos',
    description: 'Notificaciones de pedidos, pagos y retiros de CloudCoffee.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

// Pide el permiso de notificaciones si aún no está otorgado. En iOS hay que
// mirar ios.status (el campo granted raíz no cubre PROVISIONAL).
export async function solicitarPermisoNotificaciones(): Promise<boolean> {
  const actual = await Notifications.getPermissionsAsync();
  if (permitido(actual)) {
    return true;
  }

  if (actual.status === 'undetermined') {
    const pedido = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    return permitido(pedido);
  }

  return false;
}

// Devuelve el token FCM (Android) o APNs (iOS) del dispositivo.
export async function obtenerTokenFCM(): Promise<string | null> {
  const dispositivo = await Notifications.getDevicePushTokenAsync();
  return typeof dispositivo.data === 'string' ? dispositivo.data : null;
}

// Flujo completo de registro del dispositivo para push. Nunca lanza: devuelve
// un EstadoPush describiendo qué pasó (permiso, token y/o mensaje de error).
export async function registrarPush(
  onAndroid: boolean = Platform.OS === 'android'
): Promise<EstadoPush> {
  try {
    if (!onAndroid && Platform.OS === 'web') {
      return { permiso: false, token: null, mensaje: 'Push no disponible en web.' };
    }

    await crearCanalPedidos(onAndroid);

    const permiso = await solicitarPermisoNotificaciones();
    if (!permiso) {
      return { permiso: false, token: null, mensaje: 'Permiso de notificaciones denegado.' };
    }

    const token = await obtenerTokenFCM();
    if (!token) {
      return { permiso: true, token: null, mensaje: 'No se pudo obtener el token FCM.' };
    }

    await guardarToken(token);
    await registrarTokenEnBackend(token);

    return { permiso: true, token, mensaje: null };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return { permiso: false, token: null, mensaje };
  }
}

// Registra el dispositivo en el backend vía el API Gateway.
// Contrato esperado (pendiente de implementar en notification-service, no
// modificar backend en esta tarea): POST /v1/notifications/device-token
//   Body: { "token": "...", "plataforma": "android" | "ios" }
export async function registrarTokenEnBackend(token: string): Promise<void> {
  try {
    await httpClient.post('/v1/notifications/device-token', {
      token,
      plataforma: Platform.OS,
    });
  } catch (error) {
    // El endpoint aún no existe en el backend: se registra el token localmente
    // igual y se continúa sin romper el flujo de la app.
    console.warn('[push] No se pudo registrar el token FCM en el backend:', error);
  }
}

// Elimina el registro del dispositivo en el backend vía el API Gateway.
// Contrato esperado (pendiente de implementar en notification-service, no
// modificar backend en esta tarea): DELETE /v1/notifications/device-token
//   Body: { "token": "...", "plataforma": "android" | "ios" }
export async function eliminarTokenEnBackend(token: string): Promise<void> {
  try {
    await httpClient.delete('/v1/notifications/device-token', {
      data: { token, plataforma: Platform.OS },
    });
  } catch (error) {
    // El endpoint aún no existe en el backend: se limpia el token localmente
    // igual y se continúa sin romper el cierre de sesión.
    console.warn('[push] No se pudo eliminar el token FCM en el backend:', error);
  }
}

// Elimina el registro push completo del dispositivo (INT4-42): borra el token
// en el backend (si hay uno guardado) y lo limpia del almacenamiento local.
// Debe ejecutarse ANTES de limpiar los tokens de auth para que el DELETE
// viaje con el Bearer vigente. Nunca lanza.
export async function eliminarRegistroPush(): Promise<void> {
  const token = await obtenerTokenGuardado();
  if (token) {
    await eliminarTokenEnBackend(token);
  }
  await limpiarTokenGuardado();
}

// Persiste el token localmente para re-registrarlo sin depender de la sesión.
export async function guardarToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export async function obtenerTokenGuardado(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_STORAGE_KEY);
}

export async function limpiarTokenGuardado(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_STORAGE_KEY);
}

// Se suscribe a la rotación del token por parte de FCM/APNs. Devuelve una
// función de limpieza para el cleanup del useEffect.
export function suscribirRoladoDeToken(alNuevoToken: (token: string) => void): () => void {
  const suscripcion = Notifications.addPushTokenListener((dispositivo) => {
    if (typeof dispositivo.data === 'string') {
      const token = dispositivo.data;
      void guardarToken(token).then(() => alNuevoToken(token));
    }
  });

  return () => suscripcion.remove();
}

// Extrae la URL interna navegable desde data.url de una notificación push.
// Devuelve null cuando el valor no es una ruta interna segura (evita abrir
// enlaces externos o flujos de auth desde la bandeja de notificaciones).
export function urlDeNotificacion(data: Record<string, unknown> | undefined): string | null {
  const url = data?.url;
  if (typeof url !== 'string' || !url.startsWith('/')) {
    return null;
  }
  if (url.startsWith('//')) {
    return null;
  }
  if (url.startsWith('/(auth)')) {
    return null;
  }
  return url;
}

function permitido(estado: Notifications.NotificationPermissionsStatus): boolean {
  return estado.granted || estado.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}
