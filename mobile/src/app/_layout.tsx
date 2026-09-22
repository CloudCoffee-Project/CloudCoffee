import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { getAccessToken } from '../services/httpClient';
import { connectWebSocket, disconnectWebSocket } from '../services/websocket';

function RootNavigator() {
  const { sesion, bootstrapping } = useAuth();
  const insets = useSafeAreaInsets();

  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (bootstrapping) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!sesion && !inAuthGroup) {
      router.replace('/(auth)/login');
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
