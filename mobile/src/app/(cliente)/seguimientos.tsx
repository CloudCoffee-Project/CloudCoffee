// src/app/(cliente)/seguimientos.tsx
//
// Seguimiento en vivo de una orden (INT4-6, adaptado a INT4-128). El estado BASE
// se consulta por HTTP al enfocar (GET /v1/orders/{ordenId}, resolviendo la
// orden desde compraId cuando hace falta) y los CAMBIOS llegan por WebSocket
// vía useOrdenEstado. Así, recargar o reabrir siempre muestra el estado real y
// no depende de un parámetro que pueda quedar viejo.
//
// El botón de QR aparece SOLO en 'listo_para_retiro', el único estado en que
// Order habilita GET /v1/orders/{ordenId}/qr. La pantalla de QR vuelve a pedirlo
// al backend: acá no se arma ni se guarda ningún código.

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Presionable } from '../../components/Presionable';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AxiosError } from 'axios';

import { useOrdenEstado } from '../../hooks/useOrdenEstado';
import { obtenerCompra } from '../../services/compras';
import { ApiProblem, toApiError } from '../../services/httpClient';
import { obtenerOrden } from '../../services/ordenes';
import { esEstadoOrden } from '../../types/domain';
import { etiquetaEstadoOrden, visualEstadoOrden } from '../../utils/estadosOrden';
import type { EstadoOrden, Orden } from '../../types/domain';

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

// Order solo habilita el QR cuando la orden alcanzó este estado.
const ESTADO_CON_QR: EstadoOrden = 'listo_para_retiro';

// Devuelve el índice (0-based) del hito actual del timeline según el estado
// real de la orden. `pasos.length` significa "todos completados" (entregado)
// y -1 el estado terminal cancelado.
function pasoDelEstado(estado: EstadoOrden): number {
  switch (estado) {
    case 'revision_requerida':
    case 'pendiente_pago':
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

function textoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

function elegirOrden(ordenes: Orden[]): Orden | undefined {
  return (
    ordenes.find((orden) => orden.estado !== 'cancelado') ??
    (ordenes.length > 0 ? ordenes[ordenes.length - 1] : undefined)
  );
}

export default function SeguimientosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams();
  const compraId = textoUnico(params.compraId) ?? '';
  const ordenParam = textoUnico(params.ordenId) ?? textoUnico(params.id) ?? '';
  const estadoParam = textoUnico(params.estado);

  const [orden, setOrden] = useState<Orden | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    if (!ordenParam && !compraId) {
      setOrden(null);
      setError('No hay una orden asociada a esta compra.');
      setCargando(false);
      return;
    }

    setCargando(true);
    setError(null);
    try {
      let ordenResuelta: Orden | undefined;
      if (ordenParam) {
        ordenResuelta = await obtenerOrden(ordenParam);
      } else {
        const compra = await obtenerCompra(compraId);
        ordenResuelta = elegirOrden(compra.ordenes);
        if (ordenResuelta) {
          // La compra trae un snapshot; GET /orders/{id} da el estado actual.
          ordenResuelta = await obtenerOrden(ordenResuelta.ordenId);
        }
      }

      if (!ordenResuelta) {
        setOrden(null);
        setError('No hay una orden asociada a esta compra.');
        return;
      }
      setOrden(ordenResuelta);
    } catch (thrown) {
      const apiError = toApiError(thrown as AxiosError<ApiProblem>);
      console.error('[Seguimientos] No se pudo cargar la orden:', apiError.message);
      setOrden(null);
      setError(apiError.message);
    } finally {
      setCargando(false);
    }
  }, [compraId, ordenParam]);

  useFocusEffect(
    useCallback(() => {
      void recargar();
    }, [recargar])
  );

  // Suscripción en vivo: se conecta apenas conocemos el id (param o respuesta
  // del GET) y el último evento gana sobre el estado base de HTTP.
  const estadoEnVivo = useOrdenEstado(orden?.ordenId ?? ordenParam);
  const estadoBase: EstadoOrden | null = orden
    ? orden.estado
    : esEstadoOrden(estadoParam)
      ? estadoParam
      : null;
  const estado: EstadoOrden | null = esEstadoOrden(estadoEnVivo) ? estadoEnVivo : estadoBase;

  const pasoActual = estado === null ? null : pasoDelEstado(estado);
  const puedeVerQr = estado === ESTADO_CON_QR;
  const pill = estado === null ? { fondo: '#F3F4F6', texto: '#6B7280' } : visualEstadoOrden(estado);
  const etiqueta = estado === null ? 'Esperando estado…' : etiquetaEstadoOrden(estado);
  const ordenId = orden?.ordenId ?? ordenParam;

  const abrirQrRetiro = (): void => {
    if (!ordenId) return;
    router.push({
      pathname: '/(cliente)/qr-retiro',
      params: {
        ...(compraId ? { compraId } : {}),
        ordenId,
      },
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Presionable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Volver</Text>
        </Presionable>
        <Text style={styles.headerTitle}>Seguimiento</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {cargando ? (
          <View style={styles.emptyCard} testID="seguimiento-cargando">
            <ActivityIndicator size="large" color="#0052CC" />
            <Text style={styles.emptyText}>Consultando el estado de tu orden…</Text>
          </View>
        ) : error || !ordenId ? (
          <View style={styles.emptyCard} testID="seguimiento-error">
            <Text style={styles.emptyIcon}>☕</Text>
            <Text style={styles.emptyTitle}>No pudimos cargar tu orden</Text>
            <Text style={styles.emptyText}>
              {error ?? 'Cuando realices una compra en el carrito, aquí verás su seguimiento.'}
            </Text>
            <Presionable style={styles.primaryButton} onPress={() => void recargar()}>
              <Text style={styles.primaryButtonText}>Reintentar</Text>
            </Presionable>
          </View>
        ) : (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>SEGUIMIENTO DE RETIRO</Text>
            </View>
            <Text style={styles.subtitle}>El estado de tu pedido se actualiza en tiempo real.</Text>

            <View style={styles.ticketCard}>
              <Text style={styles.orderLabel}>N° DE PEDIDO</Text>
              <Text style={styles.orderId} testID="seguimiento-orden">
                #{orden?.codigoOrden || ordenId}
              </Text>
              <View style={styles.divider} />
              <View style={[styles.statusPill, { backgroundColor: pill.fondo }]}>
                <Text
                  style={[styles.statusPillText, { color: pill.texto }]}
                  testID="seguimiento-estado"
                >
                  {etiqueta}
                </Text>
              </View>
            </View>

            {estado === 'cancelado' && (
              <View style={styles.cancelBanner}>
                <Text style={styles.cancelBannerText}>Tu pedido fue cancelado.</Text>
              </View>
            )}

            <View style={styles.timelineContainer} testID="seguimiento-timeline">
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

            {puedeVerQr ? (
              <Presionable
                style={styles.primaryButton}
                onPress={abrirQrRetiro}
                testID="seguimiento-ver-qr"
              >
                <Text style={styles.primaryButtonText}>Ver código de retiro</Text>
              </Presionable>
            ) : (
              <View style={styles.qrPendiente} testID="seguimiento-sin-qr">
                <Text style={styles.qrPendienteTexto}>
                  El código de retiro se habilita cuando tu orden esté lista para retiro.
                </Text>
              </View>
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
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  qrPendiente: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  qrPendienteTexto: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
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
