// src/app/(cliente)/notificaciones.tsx
//
// Estado de las notificaciones push (FCM, INT4-41). Es una pantalla de
// verificación: lee el token FCM guardado y el permiso actual sin volver a
// registrar el dispositivo (el registro lo hace useNotificacionesPush en el
// root layout cuando hay sesión activa).
//
// NOTA: el push remoto requiere un development build (e.g. EAS) con el
// google-services.json del proyecto Firebase; en Expo Go no está disponible
// y en Android el token FCM aparece recién cuando se configura Firebase.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { obtenerTokenGuardado } from '../../services/notificacionesPush';

// require diferido: en Expo Go (Android, SDK 53+) importar expo-notifications
// lanza un error y tumbaría esta ruta. Cuando no está disponible, la pantalla
// muestra el estado sin romper.
const Notifications: typeof import('expo-notifications') | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications');
  } catch (error) {
    console.warn('[push] expo-notifications no disponible en este entorno:', error);
    return null;
  }
})();

export default function NotificacionesScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [permiso, setPermiso] = useState<string>(
    Notifications ? 'Comprobando…' : 'No disponible (Expo Go)'
  );

  useEffect(() => {
    let activo = true;

    void obtenerTokenGuardado().then((guardado) => {
      if (activo) {
        setToken(guardado);
      }
    });

    if (!Notifications) {
      return () => {
        activo = false;
      };
    }

    void Notifications.getPermissionsAsync().then((estado) => {
      if (!activo) {
        return;
      }
      setPermiso(
        estado.granted
          ? 'Otorgado'
          : estado.ios?.status === Notifications?.IosAuthorizationStatus?.PROVISIONAL
            ? 'Provisional (iOS)'
            : 'No otorgado'
      );
    });

    return () => {
      activo = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.contenido}>
        <Text style={styles.titulo}>Notificaciones push</Text>
        <Text style={styles.descripcion}>
          Estado de la integración Firebase Cloud Messaging en este dispositivo.
        </Text>

        <View style={styles.tarjeta}>
          <Text style={styles.etiqueta}>Permiso de notificaciones</Text>
          <Text style={styles.valor}>{permiso}</Text>
        </View>

        <View style={styles.tarjeta}>
          <Text style={styles.etiqueta}>Token FCM</Text>
          <Text style={[styles.valor, styles.monospace]}>
            {token ?? 'Aún no hay token guardado'}
          </Text>
          {!token && (
            <Text style={styles.ayuda}>
              El token aparece al iniciar sesión en un development build con el proyecto Firebase
              configurado (google-services.json).
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#fff' },
  contenido: { padding: 24, gap: 16 },
  titulo: { fontSize: 22, fontWeight: 'bold', color: '#0B2545' },
  descripcion: { fontSize: 14, color: '#5A6985' },
  tarjeta: {
    backgroundColor: '#F4F7FC',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E9F4',
  },
  etiqueta: { fontSize: 12, textTransform: 'uppercase', color: '#5A6985', marginBottom: 6 },
  valor: { fontSize: 15, color: '#0B2545' },
  monospace: { fontFamily: 'monospace', fontSize: 13 },
  ayuda: { fontSize: 13, color: '#5A6985', marginTop: 8, lineHeight: 18 },
});
