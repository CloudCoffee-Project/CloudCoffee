// src/app/(cliente)/qr-retiro.tsx
//
// Código QR de retiro (INT4-47, INT4-128 e INT4-103). Order genera el código
// opaco (GET /v1/orders/{ordenId}/qr) y la app SOLO lo reenvía dentro del
// payload que consume el escáner: { pedido, estado, codigo }. No se inventa un
// QR local ni se usa el folio como credencial. Si Order no habilita el código
// o viene fuera del contrato, se muestra la degradación y no se ofrece un QR
// que el backend rechazaría.
//
// Se puede abrir con compraId (lo que envía resultado-pago) y/o con ordenId/id
// (el enlace histórico desde seguimientos y Mis compras). Al ganar foco vuelve
// a consultar: recargar o reabrir refleja el estado real del backend.

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Presionable } from '../../components/Presionable';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import type { AxiosError } from 'axios';

import { obtenerCompra } from '../../services/compras';
import { ApiProblem, toApiError } from '../../services/httpClient';
import { obtenerOrden, obtenerQrRetiro } from '../../services/ordenes';
import { serializarQrRetiro } from '../../services/qrRetiro';
import { esCodigoRetiroValido, esEstadoOrden } from '../../types/domain';
import { etiquetaEstadoOrden, visualEstadoOrden } from '../../utils/estadosOrden';
import type { EstadoOrden, Orden, QrRetiro, QrRetiroBackend } from '../../types/domain';

function textoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

// De las órdenes de una compra, se muestra la que efectivamente está lista para
// retirar; si todavía no lo está, se usa la última no cancelada para poder
// ofrecer el seguimiento. Nunca se elige una orden cancelada.
function elegirOrden(ordenes: Orden[]): Orden | undefined {
  return (
    ordenes.find((orden) => orden.estado === 'listo_para_retiro') ??
    [...ordenes].reverse().find((orden) => orden.estado !== 'cancelado')
  );
}

export default function QrRetiroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams();
  const compraId = textoUnico(params.compraId) ?? '';
  const ordenParam = textoUnico(params.ordenId) ?? textoUnico(params.id) ?? '';
  const estadoParam = textoUnico(params.estado);

  const [orden, setOrden] = useState<Orden | null>(null);
  const [qr, setQr] = useState<QrRetiroBackend | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    setCargando(true);
    setError(null);
    setQr(null);

    try {
      let ordenResuelta: Orden | undefined;

      if (ordenParam) {
        ordenResuelta = await obtenerOrden(ordenParam);
      } else if (compraId) {
        const compra = await obtenerCompra(compraId);
        ordenResuelta = elegirOrden(compra.ordenes);
      }

      if (!ordenResuelta) {
        setOrden(null);
        setError('No hay una orden asociada a esta compra.');
        return;
      }

      setOrden(ordenResuelta);

      // El QR real lo habilita Order. Un error (404/409/ estado aún no listo)
      // NO se transforma en un QR local: simplemente no se muestra.
      try {
        const codigo = await obtenerQrRetiro(ordenResuelta.ordenId);
        setQr(codigo);
      } catch {
        setQr(null);
      }
    } catch (thrown) {
      const apiError = toApiError(thrown as AxiosError<ApiProblem>);
      console.error('[QrRetiro] No se pudo cargar el retiro:', apiError.message);
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

  const estadoBase: EstadoOrden | null = orden
    ? orden.estado
    : esEstadoOrden(estadoParam)
      ? estadoParam
      : null;
  const estado: EstadoOrden = estadoBase ?? 'listo_para_retiro';
  const visual = visualEstadoOrden(estado);

  // INT4-103: solo es registrable si el token opaco que entregó Order cumple el
  // contrato. El id de la orden viaja en `pedido` para que el cajero sepa qué
  // /v1/orders/{id}/entregar debe llamar; el token viaja en `codigo`.
  const codigoBackend = qr && esCodigoRetiroValido(qr.codigo) ? qr.codigo : undefined;
  const payloadQr: QrRetiro | null = codigoBackend
    ? {
        pedido: qr?.ordenId || orden?.ordenId || ordenParam,
        estado,
        codigo: codigoBackend,
      }
    : null;
  const qrValue = payloadQr ? serializarQrRetiro(payloadQr) : null;

  const abrirBoleta = (): void => {
    if (!orden) return;
    router.push({
      pathname: '/(cliente)/orden/[id]',
      params: { id: orden.ordenId, estado },
    });
  };

  const abrirSeguimiento = (): void => {
    router.push({
      pathname: '/(cliente)/seguimientos',
      params: {
        ...(compraId ? { compraId } : {}),
        ...(orden ? { ordenId: orden.ordenId } : {}),
      },
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Presionable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Volver</Text>
        </Presionable>
        <Text style={styles.headerTitle}>Código de Retiro</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {cargando ? (
          <View style={styles.emptyCard} testID="qr-retiro-cargando">
            <ActivityIndicator size="large" color="#0052CC" />
            <Text style={styles.emptyText}>Consultando el código de retiro…</Text>
          </View>
        ) : error || !orden ? (
          <View style={styles.emptyCard} testID="qr-retiro-sin-orden">
            <Text style={styles.emptyIcon}>☕</Text>
            <Text style={styles.emptyTitle}>No pudimos encontrar tu pedido</Text>
            <Text style={styles.emptyText}>
              {error ?? 'Cuando realices una compra en el carrito, aquí verás tu código QR.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>SEGUIMIENTO DE RETIRO</Text>
            </View>
            <Text style={styles.title}>
              {codigoBackend ? 'Tu pedido está listo' : 'Tu código todavía no está disponible'}
            </Text>
            <Text style={styles.subtitle}>
              {codigoBackend
                ? 'Presenta este código QR en la barra de la cafetería para retirar tu compra.'
                : 'Order habilita el QR cuando el pago esté aprobado y la orden lista para retiro.'}
            </Text>

            {!codigoBackend ? (
              <View style={styles.sinCodigoBanner} testID="cliente-qr-sin-codigo">
                <Text style={styles.sinCodigoTexto}>
                  El código de retiro del backend todavía no está disponible o no cumple el
                  contrato. Este QR no permite registrar la entrega.
                </Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <View style={styles.ticketTop}>
                <View>
                  <Text style={styles.orderLabel}>N° DE PEDIDO</Text>
                  <Text style={styles.orderId}>#{orden.codigoOrden || orden.ordenId}</Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: visual.fondo }]}>
                  <Text style={[styles.statusPillText, { color: visual.texto }]}>
                    {etiquetaEstadoOrden(estado)}
                  </Text>
                </View>
              </View>

              {qrValue ? (
                <View style={styles.qrSection}>
                  <View style={styles.qrWrapper} testID="qr-retiro-codigo">
                    <QRCode value={qrValue} size={180} color="#0052CC" backgroundColor="#FFFFFF" />
                  </View>
                  <View style={styles.idPill}>
                    <Text style={styles.idPillText} testID="qr-retiro-codigo-texto">
                      Código: {qr?.codigo}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.qrPendiente} testID="qr-retiro-sin-qr">
                  <Text style={styles.qrPendienteIcono}>⏳</Text>
                  <Text style={styles.qrPendienteTexto}>
                    El código QR se habilita automáticamente cuando tu orden esté lista para retiro.
                  </Text>
                </View>
              )}
            </View>

            {!qrValue && (
              <Presionable
                style={styles.downloadButton}
                onPress={abrirSeguimiento}
                testID="qr-retiro-ver-seguimiento"
              >
                <Text style={styles.downloadButtonText}>Ver orden en vivo</Text>
              </Presionable>
            )}

            <Presionable style={styles.boletaButton} onPress={abrirBoleta} testID="abrir-boleta">
              <Text style={styles.boletaButtonText}>📄 Ver Boleta en PDF</Text>
            </Presionable>
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
    marginBottom: 8,
  },
  badgeText: {
    color: '#B28300',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    color: '#0052CC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 20,
  },
  sinCodigoBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F3DC87',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  sinCodigoTexto: {
    color: '#92400E',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  ticketTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
    borderStyle: 'dashed',
    paddingBottom: 14,
  },
  orderLabel: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  orderId: {
    color: '#0052CC',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  qrSection: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 18,
  },
  qrWrapper: {
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderWidth: 2,
    borderColor: '#EFE9DE',
    borderRadius: 16,
    shadowColor: '#0052CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  qrPendiente: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 28,
  },
  qrPendienteIcono: {
    fontSize: 32,
  },
  qrPendienteTexto: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  idPill: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  idPillText: {
    color: '#0052CC',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  downloadButton: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  boletaButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  boletaButtonText: {
    color: '#0052CC',
    fontSize: 15,
    fontWeight: '700',
  },
  downloadButtonText: {
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
