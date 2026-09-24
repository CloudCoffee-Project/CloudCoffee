import { useCallback, useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import type { Href } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { useNotificacionesPush } from '../hooks/useNotificacionesPush';
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

  // Push (FCM, INT4-41): registra el dispositivo solo con sesión activa y
  // escucha notificaciones recibidas/abiertas.
  const { estado: estadoPush, ultimaNotificacion } = useNotificacionesPush(
    sesion ? abrirDesdePush : undefined,
    Boolean(sesion)
  );

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

  return <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
