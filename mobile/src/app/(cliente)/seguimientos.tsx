// src/app/(cliente)/seguimientos.tsx
//
// Seguimiento en vivo de una orden. Rediseñado siguiendo el mockup de
// SEGUIMIENTO (cloudcoffee-react: Mi_Pedido): badge de seguimiento, tarjeta
// con N° de pedido + pill de estado y timeline de pasos.
//
// El estado viene en tiempo real via useOrdenEstado (WebSocket, INT4-6) y se
// mapea al union EstadoOrden de src/types/domain.ts con el helper
// pasoDelEstado (sin índices mágicos). No hay timers ni datos mockeados.

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useOrdenEstado } from '../../hooks/useOrdenEstado';
import { esEstadoOrden } from '../../types/domain';
import type { EstadoOrden } from '../../types/domain';

const PASOS_SEGUIMIENTO = [
  {
    titulo: 'Orden recibida',
    descripcion: 'Tu pedido fue confirmado y está en proceso.',
  },
  {
    titulo: 'Preparando tu pedido',
    descripcion: 'Los baristas están preparando tu café en la cafetería.',
  },
  {
    titulo: 'Listo para retiro',
    descripcion: 'Tu pedido te espera en la barra de la cafetería.',
  },
] as const;

// Estados desde los que el cliente puede presentar el QR en el punto de retiro.
const ESTADOS_DE_RETIRO: readonly EstadoOrden[] = [
  'listo_para_retiro',
  'no_retirado_pendiente_revision',
  'no_retirado_final',
];

// Devuelve el índice (0-based) del hito actual del timeline según el estado
// real de la orden. `pasos.length` significa "todos completados" (entregado)
// y -1 el estado terminal cancelado.
function pasoDelEstado(estado: EstadoOrden): number {
  switch (estado) {
    case 'reservando':
      return 0;
    case 'pagado':
      return 1;
    case 'listo_para_retiro':
    case 'no_retirado_pendiente_revision':
    case 'no_retirado_final':
      return 2;
    case 'entregado':
      return PASOS_SEGUIMIENTO.length;
    case 'cancelado':
      return -1;
  }
}

// Etiquetas de estado idénticas a las del mockup (🔵 Pagado / 🟢 Listo para
// retiro / ⚪ Entregado).
function etiquetaDeEstado(estado: EstadoOrden): string {
  switch (estado) {
    case 'reservando':
      return '🔵 Reservando';
    case 'pagado':
      return '🔵 Pagado';
    case 'listo_para_retiro':
      return '🟢 Listo para retiro';
    case 'no_retirado_pendiente_revision':
      return '🟡 No retirado (en revisión)';
    case 'entregado':
      return '⚪ Entregado';
    case 'no_retirado_final':
      return '🟡 No retirado';
    case 'cancelado':
      return '⚪ Cancelado';
  }
}

function clasePill(estado: EstadoOrden): { fondo: string; texto: string } {
  switch (estado) {
    case 'reservando':
    case 'pagado':
      return { fondo: '#DBEAFE', texto: '#1E40AF' };
    case 'listo_para_retiro':
    case 'no_retirado_pendiente_revision':
    case 'no_retirado_final':
      return { fondo: '#DCFCE7', texto: '#166534' };
    case 'entregado':
    case 'cancelado':
      return { fondo: '#F3F4F6', texto: '#6B7280' };
  }
}

function textoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default function SeguimientosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams();
  const ordenId = textoUnico(params.id) ?? '';

  // Estado en tiempo real: llega por el topic /topic/orden/{ordenId}/estado.
  // Antes del primer mensaje es null y el timeline se muestra completo en
  // pendiente, sin datos inventados.
  const estadoEnVivo = useOrdenEstado(ordenId);
  const estado: EstadoOrden | null = esEstadoOrden(estadoEnVivo) ? estadoEnVivo : null;
  const pasoActual = estado === null ? null : pasoDelEstado(estado);
  const puedeVerQr = estado !== null && ESTADOS_DE_RETIRO.includes(estado);
  const pill = estado === null ? { fondo: '#F3F4F6', texto: '#6B7280' } : clasePill(estado);
  const etiqueta = estado === null ? 'Esperando estado…' : etiquetaDeEstado(estado);

  const abrirQrRetiro = () => {
    if (!estado) return;
    router.push({
      pathname: '/(cliente)/qr-retiro',
      params: { id: ordenId, estado },
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Seguimiento</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!ordenId ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>☕</Text>
            <Text style={styles.emptyTitle}>No tienes pedidos activos</Text>
            <Text style={styles.emptyText}>
              Cuando realices una compra en el carrito, aquí verás el seguimiento de tu pedido.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>SEGUIMIENTO DE RETIRO</Text>
            </View>
            <Text style={styles.subtitle}>El estado de tu pedido se actualiza en tiempo real.</Text>

            <View style={styles.ticketCard}>
              <Text style={styles.orderLabel}>N° DE PEDIDO</Text>
              <Text style={styles.orderId}>#{ordenId}</Text>
              <View style={styles.divider} />
              <View style={[styles.statusPill, { backgroundColor: pill.fondo }]}>
                <Text style={[styles.statusPillText, { color: pill.texto }]}>{etiqueta}</Text>
              </View>
            </View>

            {estado === 'cancelado' && (
              <View style={styles.cancelBanner}>
                <Text style={styles.cancelBannerText}>Tu pedido fue cancelado.</Text>
              </View>
            )}

            <View style={styles.timelineContainer}>
              {PASOS_SEGUIMIENTO.map((paso, index) => {
                const completado = pasoActual !== null && index < pasoActual;
                const activo = pasoActual === index;
                const lineaCompletada = pasoActual !== null && pasoActual > index;

                return (
                  <View key={paso.titulo} style={styles.timelineItem}>
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
                      {index < PASOS_SEGUIMIENTO.length - 1 && (
                        <View
                          style={[
                            styles.line,
                            lineaCompletada ? styles.lineCompleted : styles.linePending,
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

            {puedeVerQr && (
              <Pressable
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
                onPress={abrirQrRetiro}
              >
                <Text style={styles.primaryButtonText}>Ver código de retiro</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
  },
  backButton: {
    width: 60,
  },
  backText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#1D2433',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSpacer: {
    width: 60,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginBottom: 10,
  },
  badgeText: {
    color: '#B28300',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  orderLabel: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  orderId: {
    color: '#0052CC',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: '#EFE9DE',
    marginVertical: 14,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  cancelBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 24,
  },
  cancelBannerText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  timelineContainer: {
    paddingLeft: 8,
    marginTop: 24,
    marginBottom: 28,
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
    backgroundColor: '#FAF7F2',
  },
  circleCompleted: {
    borderColor: '#0052CC',
    backgroundColor: '#0052CC',
  },
  circleActive: {
    borderColor: '#0052CC',
    borderWidth: 3,
    backgroundColor: '#FFFFFF',
  },
  circlePending: {
    borderColor: '#D1D5DB',
    backgroundColor: '#FAF7F2',
  },
  innerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0052CC',
  },
  line: {
    width: 2,
    flex: 1,
    minHeight: 45,
    marginVertical: -2,
    zIndex: 1,
  },
  lineCompleted: {
    backgroundColor: '#0052CC',
  },
  linePending: {
    backgroundColor: '#E5E7EB',
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 32,
    paddingTop: 2,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9CA3AF',
    marginBottom: 4,
  },
  stepTitleActive: {
    color: '#1D2433',
  },
  stepDescription: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
  },
  primaryButton: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#0052CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderStyle: 'dashed',
    borderRadius: 18,
    paddingVertical: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  emptyIcon: {
    fontSize: 44,
  },
  emptyTitle: {
    color: '#1D2433',
    fontSize: 17,
    fontWeight: '800',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
