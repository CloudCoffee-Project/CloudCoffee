import { useCallback, useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import type { Href } from 'expo-router';
import { StyleSheet, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import BannerNotificacionPush from '../components/BannerNotificacionPush';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { useCafeteriaActual } from '../hooks/useCafeteriaActual';
import { useNotificacionesPush } from '../hooks/useNotificacionesPush';
import type { NotificacionRecibida } from '../hooks/useNotificacionesPush';
import { useNotificacionesStock } from '../hooks/useNotificacionesStock';
import { getAccessToken } from '../services/httpClient';
import { connectWebSocket, disconnectWebSocket } from '../services/websocket';

function RootNavigator() {
  const { sesion, bootstrapping } = useAuth();
  const insets = useSafeAreaInsets();

  const segments = useSegments();
  const router = useRouter();

  // Al tocar una notificación push, navega a la ruta interna que llegó en
  // data.url (ver urlDeNotificacion: solo rutas internas, nunca (auth)).
  const abrirDesdePush = useCallback(
    (url: string) => {
      router.push(url as Href);
    },
    [router]
  );

  // Push (FCM, INT4-41/INT4-43): registra el dispositivo solo con sesión
  // activa y escucha notificaciones recibidas/abiertas. La bandeja local la
  // mantienen los listeners del hook (historialNotificaciones).
  const { estado: estadoPush, ultimaNotificacion } = useNotificacionesPush(
    sesion ? abrirDesdePush : undefined,
    Boolean(sesion)
  );

  // Stock en tiempo real (INT4-46): la cafetería a la que suscribirse depende
  // del rol (cajero → sesion.cafeteriaId; cliente → cafetería del campus
  // seleccionado). Cuando un producto pasa a agotado o vuelve a disponible,
  // la notificación entra a la bandeja y se muestra en el banner.
  const cafeteriaActual = useCafeteriaActual(
    sesion?.rol,
    sesion?.cafeteriaId ?? null,
    sesion?.userId
  );
  const { ultimaNotificacion: ultimaNotificacionStock } = useNotificacionesStock(
    cafeteriaActual,
    Boolean(sesion)
  );

  // El banner muestra la última notificación recibida de cualquiera de las dos
  // fuentes (push FCM o evento de stock): gana la que llegue más reciente.
  const [notificacionBanner, setNotificacionBanner] = useState<NotificacionRecibida | null>(null);
  useEffect(() => {
    if (ultimaNotificacion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- el banner debe reflejar la última notificación de cada fuente en cuanto llega
      setNotificacionBanner(ultimaNotificacion);
    }
  }, [ultimaNotificacion]);
  useEffect(() => {
    if (ultimaNotificacionStock) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- el banner debe reflejar la última notificación de cada fuente en cuanto llega
      setNotificacionBanner(ultimaNotificacionStock);
    }
  }, [ultimaNotificacionStock]);

  // Depuración de FCM: mientras el push remoto no esté operativo (requiere
  // development build + google-services.json del proyecto Firebase), estos
  // logs muestran el motivo y la última notificación recibida.
  useEffect(() => {
    if (estadoPush.mensaje) {
      console.warn('[push]', estadoPush.mensaje);
    }
    if (ultimaNotificacion) {
      console.warn('[push] notificación recibida:', ultimaNotificacion);
    }
  }, [estadoPush, ultimaNotificacion]);

  useEffect(() => {
    if (bootstrapping) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!sesion && !inAuthGroup) {
      router.replace('/(auth)/portada');
    } else if (sesion) {
      if (sesion.rol === 'cajero' && segments[0] !== '(cajero)') {
        router.replace('/(cajero)');
      } else if (sesion.rol !== 'cajero' && segments[0] !== '(cliente)') {
        router.replace('/(cliente)');
      }
    }
  }, [sesion, bootstrapping, segments, router]);

  // WebSocket de notificaciones: usa el accessToken real una vez autenticado.
  useEffect(() => {
    const token = getAccessToken();
    connectWebSocket(token ?? 'token_de_prueba', () => {
      console.warn('¡Listo! Conexión WebSocket establecida');
    });

    return () => {
      disconnectWebSocket();
    };
  }, [sesion]);

  if (bootstrapping) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: insets.top,
        }}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.contenedor}>
      <Slot />
      {/* Despliegue en primer plano (INT4-43): banner in-app con la última
          notificación recibida. Sin sesión no navega, solo informa. */}
      <BannerNotificacionPush
        notificacion={notificacionBanner}
        onAbrir={sesion ? abrirDesdePush : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
