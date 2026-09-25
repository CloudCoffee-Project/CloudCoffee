// src/app/(cliente)/notificaciones.tsx
//
// Bandeja de notificaciones push (INT4-43). Muestra el historial local de
// notificaciones recibidas —en primer plano, segundo plano o con la app
// cerrada— con su estado leída/no leída y la ruta interna asociada (data.url).
//
// El historial lo mantienen los listeners de useNotificacionesPush (servicio
// historialNotificaciones, AsyncStorage). Esta pantalla solo lee y actualiza
// ese almacén; se recarga al enfocarse para reflejar avisos recibidos mientras
// el usuario estaba en otra pantalla. También permite marcar todo como leído,
// vaciar la bandeja y abrir cada aviso desde aquí.
//
// Al pie se conserva el estado del push en el dispositivo (permiso + token
// FCM, INT4-41), útil durante el desarrollo.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
  vaciarHistorial,
} from '../../services/historialNotificaciones';
import type { NotificacionHistorial } from '../../services/historialNotificaciones';
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
  const router = useRouter();
  // null = aún cargando (el historial se lee del almacén local)
  const [historial, setHistorial] = useState<NotificacionHistorial[] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [permiso, setPermiso] = useState<string>(
    Notifications ? 'Comprobando…' : 'No disponible (Expo Go)'
  );

  const recargar = useCallback(async (): Promise<void> => {
    const lista = await listarNotificaciones();
    setHistorial(lista);
  }, []);

  // Se recarga al ganar foco: los avisos recibidos en segundo plano o desde
  // otra pantalla ya quedaron en el historial local.
  useFocusEffect(
    useCallback(() => {
      void recargar();
    }, [recargar])
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

  const abrirNotificacion = (notificacion: NotificacionHistorial): void => {
    if (!notificacion.leida) {
      void marcarLeida(notificacion.id).then(() => {
        setHistorial(
          (previo) =>
            previo?.map((n) => (n.id === notificacion.id ? { ...n, leida: true } : n)) ?? null
        );
      });
    }
    if (notificacion.url) {
      router.push(notificacion.url as Href);
    }
  };

  const marcarTodas = (): void => {
    void marcarTodasLeidas().then((actualizado) => setHistorial(actualizado));
  };

  const vaciar = (): void => {
    void vaciarHistorial().then(() => setHistorial([]));
  };

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.contenido}>
        <Text style={styles.titulo}>Notificaciones</Text>
        <Text style={styles.descripcion}>
          Avisos de tus pedidos, pagos, retiros y del estado de los productos (agotados o
          disponibles). Quedan guardados aquí aunque la app esté en segundo plano o cerrada.
        </Text>

        {historial === null ? (
          <View style={styles.tarjetaCentrada} testID="bandeja-cargando">
            <Text style={styles.ayuda}>Cargando notificaciones…</Text>
          </View>
        ) : historial.length === 0 ? (
          <View style={styles.tarjetaCentrada} testID="bandeja-vacia">
            <Text style={styles.vacioTitulo}>Aún no hay notificaciones</Text>
            <Text style={styles.ayuda}>
              Cuando llegue un aviso de un pedido, un pago, un retiro o del estado de un producto
              (agotado/disponible), aparecerá aquí.
            </Text>
          </View>
        ) : (
          <View style={styles.lista} testID="lista-notificaciones">
            <View style={styles.acciones}>
              <TouchableOpacity
                style={styles.botonAccion}
                onPress={marcarTodas}
                testID="marcar-todas-leidas"
              >
                <Text style={styles.botonAccionTexto}>✓ Marcar todas leídas</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.botonAccion} onPress={vaciar} testID="vaciar-bandeja">
                <Text style={styles.botonAccionTexto}>Vaciar</Text>
              </TouchableOpacity>
            </View>

            {historial.map((notificacion) => (
              <Pressable
                key={notificacion.id}
                onPress={() => abrirNotificacion(notificacion)}
                style={[styles.item, notificacion.leida ? styles.itemLeida : null]}
                testID={`notificacion-item-${notificacion.id}`}
              >
                <View style={[styles.punto, notificacion.leida ? styles.puntoLeida : null]} />
                <View style={styles.itemContenido}>
                  {notificacion.titulo ? (
                    <Text style={styles.itemTitulo} numberOfLines={2}>
                      {notificacion.titulo}
                    </Text>
                  ) : null}
                  {notificacion.cuerpo ? (
                    <Text style={styles.itemCuerpo} numberOfLines={3}>
                      {notificacion.cuerpo}
                    </Text>
                  ) : null}
                  <Text style={styles.itemFecha}>
                    {formatearTiempoRelativo(notificacion.fechaIso)}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.estado} testID="estado-push">
          <Text style={styles.estadoTitulo}>Estado del push en este dispositivo</Text>
          <Text style={styles.estadoFila}>Permiso: {permiso}</Text>
          <Text style={[styles.estadoFila, styles.monospace]} numberOfLines={2}>
            Token FCM: {token ?? 'Aún no hay token guardado'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Formato relativo corto para la fecha de cada aviso ("Hace 5 min", "Hace 3 h").
function formatearTiempoRelativo(iso: string): string {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) {
    return 'Ahora';
  }
  if (minutos < 60) {
    return `Hace ${minutos} min`;
  }
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    return `Hace ${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  if (dias < 7) {
    return `Hace ${dias} d`;
  }
  return new Date(iso).toLocaleDateString('es-CL');
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: '#fff' },
  contenido: { padding: 24, gap: 16 },
  titulo: { fontSize: 22, fontWeight: 'bold', color: '#0B2545' },
  descripcion: { fontSize: 14, color: '#5A6985', lineHeight: 19 },
  tarjetaCentrada: {
    backgroundColor: '#F4F7FC',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E9F4',
    gap: 6,
  },
  vacioTitulo: { fontSize: 15, fontWeight: '700', color: '#0B2545' },
  ayuda: { fontSize: 13, color: '#5A6985', lineHeight: 18 },
  lista: { gap: 10 },
  acciones: { flexDirection: 'row', gap: 8 },
  botonAccion: {
    flex: 1,
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#D4E2F7',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  botonAccionTexto: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  item: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#F4F7FC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E9F4',
  },
  itemLeida: { backgroundColor: '#FFFFFF', opacity: 0.85 },
  punto: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563EB',
    marginTop: 5,
  },
  puntoLeida: { backgroundColor: '#CBD5E1' },
  itemContenido: { flex: 1, gap: 2 },
  itemTitulo: { fontSize: 14, fontWeight: '800', color: '#0B2545' },
  itemCuerpo: { fontSize: 13, color: '#33415C', lineHeight: 18 },
  itemFecha: { fontSize: 11, color: '#8A97B0', marginTop: 4 },
  estado: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  estadoTitulo: { fontSize: 12, textTransform: 'uppercase', color: '#5A6985', marginBottom: 2 },
  estadoFila: { fontSize: 13, color: '#0B2545' },
  monospace: { fontFamily: 'monospace', fontSize: 12 },
});
