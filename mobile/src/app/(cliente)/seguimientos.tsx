import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SeguimientosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [estadoActual, setEstadoActual] = useState(1);
  const [cargandoInicial, setCargandoInicial] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const ordenMock = { id: '1042', producto: 'Café Latte Vainilla' };

  const pasos = [
    {
      id: 1,
      titulo: 'Orden Recibida',
      descripcion: 'Hemos recibido tu pedido y el pago fue confirmado.',
    },
    {
      id: 2,
      titulo: 'Preparando',
      descripcion: 'Tu café está siendo preparado por nuestros baristas.',
    },
    {
      id: 3,
      titulo: 'Listo para retiro',
      descripcion: 'Tu pedido te espera en la barra de la cafetería.',
    },
  ];

  const obtenerEstadoDelPedido = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setEstadoActual((prev) => (prev < 3 ? prev + 1 : 1));
    } catch (error) {
      console.error('Error al obtener el seguimiento:', error);
    }
  };

  useEffect(() => {
    const cargarDatos = async () => {
      await obtenerEstadoDelPedido();
      setCargandoInicial(false);
    };

    cargarDatos();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    await obtenerEstadoDelPedido();
    setRefrescando(false);
  }, []);

  if (cargandoInicial) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color="#0284C7" />
        <Text style={styles.loadingText}>Cargando tu pedido...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Seguimiento</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={onRefresh}
            tintColor="#0284C7"
            colors={['#0284C7']}
          />
        }
      >
        <View style={styles.ticketCard}>
          <Text style={styles.orderLabel}>N° DE PEDIDO</Text>
          <Text style={styles.orderId}>#{ordenMock.id}</Text>
          <View style={styles.divider} />
          <Text style={styles.productName}>{ordenMock.producto}</Text>

          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>Desliza hacia abajo para actualizar</Text>
          </View>
        </View>

        <View style={styles.timelineContainer}>
          {pasos.map((paso, index) => {
            const completado = estadoActual > paso.id;
            const activo = estadoActual === paso.id;
            const ultimo = index === pasos.length - 1;

            return (
              <View key={paso.id} style={styles.timelineItem}>
                <View style={styles.indicatorContainer}>
                  <View
                    style={[
                      styles.circle,
                      completado && styles.circleCompleted,
                      activo && styles.circleActive,
                      !completado && !activo && styles.circlePending,
                    ]}
                  >
                    {activo && <View style={styles.innerDot} />}
                  </View>
                  {!ultimo && (
                    <View
                      style={[
                        styles.line,
                        estadoActual > paso.id ? styles.lineCompleted : styles.linePending,
                      ]}
                    />
                  )}
                </View>

                <View style={styles.timelineContent}>
                  <Text
                    style={[styles.stepTitle, (activo || completado) && styles.stepTitleActive]}
                  >
                    {paso.titulo}
                  </Text>
                  <Text style={styles.stepDescription}>{paso.descripcion}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {estadoActual === 3 && (
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            onPress={() => alert('Próximamente: Código QR de retiro (Tarea 47)')}
          >
            <Text style={styles.primaryButtonText}>Ver código de retiro</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5EFE6',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#7A7067',
    fontSize: 14,
    fontWeight: '500',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(229, 221, 211, 0.5)',
  },
  backButton: {
    width: 60,
  },
  backText: {
    color: '#2D1B14',
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#2D1B14',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 36,
    shadowColor: '#2D1B14',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(229, 221, 211, 0.7)',
  },
  orderLabel: {
    color: '#7A7067',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  orderId: {
    color: '#0284C7',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#E5DDD3',
    marginVertical: 16,
  },
  productName: {
    color: '#2D1B14',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  hintContainer: {
    marginTop: 16,
    backgroundColor: '#F5EFE6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  hintText: {
    color: '#A89F95',
    fontSize: 11,
    fontWeight: '600',
  },
  timelineContainer: {
    paddingLeft: 8,
    marginBottom: 40,
  },
  timelineItem: {
    flexDirection: 'row',
  },
  indicatorContainer: {
    alignItems: 'center',
    width: 32,
    marginRight: 16,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    backgroundColor: '#F5EFE6',
  },
  circleCompleted: {
    borderColor: '#0284C7',
    backgroundColor: '#0284C7',
  },
  circleActive: {
    borderColor: '#0284C7',
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
  },
  circlePending: {
    borderColor: '#D4CDC4',
    backgroundColor: '#F5EFE6',
  },
  innerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0284C7',
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 45,
    marginVertical: -2,
    zIndex: 1,
  },
  lineCompleted: {
    backgroundColor: '#0284C7',
  },
  linePending: {
    backgroundColor: '#D4CDC4',
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 36,
    paddingTop: 2,
  },
  stepTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#A89F95',
    marginBottom: 4,
  },
  stepTitleActive: {
    color: '#2D1B14',
  },
  stepDescription: {
    fontSize: 14,
    color: '#7A7067',
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: '#2D1B14',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#2D1B14',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    color: '#FAF6F0',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
