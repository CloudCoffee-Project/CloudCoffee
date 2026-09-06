import { useEffect, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import type { SesionDecodificada } from '../types/domain';

export default function RootLayout() {
  const [bootstrapping] = useState(false);
  const [sesion] = useState<SesionDecodificada | null>(null);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (bootstrapping) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!sesion && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (sesion) {
      // Si hay sesión, evitamos que entre al login de nuevo
      if (sesion.rol === 'cajero' && segments[0] !== '(cajero)') {
        router.replace('/(cajero)');
      } else if (sesion.rol !== 'cajero' && segments[0] !== '(cliente)') {
        router.replace('/(cliente)');
      }
    }
  }, [sesion, bootstrapping, segments, router]);

  if (bootstrapping) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return <Slot />;
}
