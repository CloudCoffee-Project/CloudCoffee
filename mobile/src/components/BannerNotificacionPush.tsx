// src/components/BannerNotificacionPush.tsx
//
// Banner in-app que despliega la última notificación push recibida cuando la
// app está en primer plano (INT4-43). Aparece unos segundos sobre el contenido
// y se oculta solo; al tocarlo navega a la ruta interna asociada (data.url).
//
// La visibilidad la maneja el hook desde _layout (ultimaNotificacion): este
// componente solo recibe la notificación nueva y administra su propio timer.

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NotificacionRecibida } from '../hooks/useNotificacionesPush';

const DURACION_VISIBLE_MS = 4000;

interface BannerNotificacionPushProps {
  notificacion: NotificacionRecibida | null;
  onAbrir?: (url: string) => void;
}

export default function BannerNotificacionPush({
  notificacion,
  onAbrir,
}: BannerNotificacionPushProps) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!notificacion) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mostrar el banner al llegar una notificación nueva es el propósito de este efecto
    setVisible(true);
    if (temporizador.current) {
      clearTimeout(temporizador.current);
    }
    temporizador.current = setTimeout(() => setVisible(false), DURACION_VISIBLE_MS);

    return () => {
      if (temporizador.current) {
        clearTimeout(temporizador.current);
      }
    };
  }, [notificacion]);

  if (!visible || !notificacion) {
    return null;
  }

  const cerrar = (): void => setVisible(false);

  return (
    <Pressable
      testID="banner-notificacion"
      accessibilityRole="button"
      accessibilityLabel={`Notificación: ${notificacion.titulo ?? 'nuevo aviso'}`}
      onPress={() => {
        if (notificacion.url && onAbrir) {
          onAbrir(notificacion.url);
        }
        cerrar();
      }}
      style={[styles.envoltorio, { top: insets.top + 8 }]}
    >
      <View style={styles.icono}>
        <Text style={styles.iconoTexto}>🔔</Text>
      </View>
      <View style={styles.contenido}>
        <Text style={styles.titulo} numberOfLines={1}>
          {notificacion.titulo ?? 'Nueva notificación'}
        </Text>
        {notificacion.cuerpo ? (
          <Text style={styles.cuerpo} numberOfLines={2}>
            {notificacion.cuerpo}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  envoltorio: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0B2545',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  icono: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconoTexto: { fontSize: 18 },
  contenido: { flex: 1, gap: 2 },
  titulo: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  cuerpo: { color: '#C9D6EA', fontSize: 12, lineHeight: 16 },
});
