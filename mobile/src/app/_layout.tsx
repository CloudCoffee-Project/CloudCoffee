import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import type { SesionDecodificada } from '../types/domain';
import { connectWebSocket, disconnectWebSocket } from '../services/websocket';

export default function RootLayout() {
  const [bootstrapping] = useState(false);

  //inicio de sesión de prueba para desarrollo. En producción, se reemplazará por el flujo real de login/sesión (INT4-2)
  // para dejar como lo anterior usar el:
  //const [sesion] = useState<SesionDecodificada | null>(null);

  const [sesion] = useState<SesionDecodificada | null>({
    id: '1',
    nombre: 'Usuario Test',
    rol: 'cliente',
  } as any);

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

  // TODO: reemplazar este token de prueba por el accessToken real una vez
  // que el flujo de login/sesión esté conectado (INT4-2, prueba temporal)
  useEffect(() => {
    const tokenDePrueba = 'token_de_prueba';
    connectWebSocket(tokenDePrueba, () => {
      console.warn('¡Listo! Conexión WebSocket establecida');
    });

    return () => {
      disconnectWebSocket();
    };
  }, []);

  if (bootstrapping) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Slot />;
}
