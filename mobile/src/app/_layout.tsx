import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import type { SesionDecodificada } from '../types/domain';

export default function RootLayout() {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [sesion, setSesion] = useState<SesionDecodificada | null>(null);
  
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // TODO(INT4-22): reemplazar por authStorage.getDecodedSession() real.
    setSesion(null);
    setBootstrapping(false);
  }, []);

  useEffect(() => {
    if (bootstrapping) return;

    // segments[0] nos dice en qué carpeta principal (grupo) estamos navegando
    const inAuthGroup = segments[0] === '(auth)';

    if (!sesion && !inAuthGroup) {
      // Si no hay sesión y no estamos en auth, mandamos a login
      router.replace('/(auth)/login');
    } else if (sesion) {
      // Si hay sesión, evitamos que entre al login de nuevo
      if (sesion.rol === 'cajero' && segments[0] !== '(cajero)') {
        router.replace('/(cajero)');
      } else if (sesion.rol !== 'cajero' && segments[0] !== '(cliente)') {
        router.replace('/(cliente)');
      }
    }
  }, [sesion, bootstrapping, segments]);

  if (bootstrapping) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Permite que las pantallas hijas se rendericen correctamente
  return <Slot />;
}