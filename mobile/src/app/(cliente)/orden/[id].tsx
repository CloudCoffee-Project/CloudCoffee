// src/app/(cliente)/orden/[id].tsx
//
// Detalle de una orden del cliente enfocado en la boleta (INT4-48): descarga
// la boleta simplificada en PDF de la orden pagada y la abre en el share sheet
// del sistema para guardarla/visualizarla. Ruta interna: se llega desde
// qr-retiro.tsx (Código de Retiro) pasando el id de la orden por params.
//
// El PDF sale de GET /v1/orders/{id}/boleta (services/boletas.ts): el
// httpClient inyecta el JWT, los bytes se guardan en el dispositivo con
// expo-file-system y se comparten con expo-sharing. El backend todavía no
// implementa el endpoint (mismo TODO que ordenes.ts): la pantalla consume el
// contrato real y muestra el error normalizado (ApiError) si el gateway
// responde con problem+json.

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../../../services/httpClient';
import { compartirBoleta, descargarBoleta, guardarBoletaPdf } from '../../../services/boletas';

function textoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default function DetalleOrdenScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams();
  const ordenId = textoUnico(params.id) ?? '';

  // null = no se ha intentado descargar aún; string = mensaje de éxito/error.
  const [descargando, setDescargando] = useState(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const descargarBoletaPdf = async (): Promise<void> => {
    if (!ordenId || descargando) {
      return;
    }

    setDescargando(true);
    setMensajeExito(null);
    setError(null);

    try {
      const bytes = await descargarBoleta(ordenId);
      const uri = guardarBoletaPdf(ordenId, bytes);
      const compartida = await compartirBoleta(uri);
      setMensajeExito(
        compartida
          ? 'Boleta en PDF lista para guardar o abrir.'
          : 'Boleta en PDF descargada y guardada en el dispositivo.'
      );
    } catch (e) {
      const apiError =
        e instanceof ApiError ? e : new ApiError('No se pudo descargar la boleta.', 0);
      setError(apiError.message);
    } finally {
      setDescargando(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.backButton}
          testID="volver-boleta"
        >
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Boleta de la Orden</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!ordenId ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📄</Text>
            <Text style={styles.emptyTitle}>No hay una orden seleccionada</Text>
            <Text style={styles.emptyText}>
              Vuelve a tu pedido desde el código de retiro para descargar la boleta.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>BOLETA SIMPLIFICADA</Text>
            </View>
            <Text style={styles.title}>Descarga la boleta de tu pedido</Text>
            <Text style={styles.subtitle}>
              La boleta se genera en PDF al confirmarse el pago y queda disponible aquí para
              guardarla o abrirla cuando la necesites.
            </Text>

            <View style={styles.card}>
              <Text style={styles.orderLabel}>N° DE PEDIDO</Text>
              <Text style={styles.orderId}>#{ordenId}</Text>
              <View style={styles.divider} />
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Documento</Text>
                <Text style={styles.detailValue}>PDF</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Emisión</Text>
                <Text style={styles.detailValue}>Al confirmar el pago</Text>
              </View>
            </View>

            {mensajeExito ? (
              <View style={styles.bannerExito} testID="boleta-exito">
                <Text style={styles.bannerExitoTexto}>{mensajeExito}</Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.bannerError} testID="boleta-error">
                <Text style={styles.bannerErrorTitulo}>No se pudo descargar la boleta</Text>
                <Text style={styles.bannerErrorTexto}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.downloadButton,
                (pressed || descargando) && styles.buttonPressed,
              ]}
              onPress={() => void descargarBoletaPdf()}
              disabled={descargando}
              testID="descargar-boleta"
            >
              {descargando ? (
                <View style={styles.descargandoContenido}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.downloadButtonText}>Descargando boleta…</Text>
                </View>
              ) : (
                <Text style={styles.downloadButtonText}>⬇ Descargar Boleta (PDF)</Text>
              )}
            </Pressable>
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
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  badgeText: {
    color: '#0052CC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
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
  divider: {
    height: 1,
    backgroundColor: '#EFE9DE',
    borderStyle: 'dashed',
    marginVertical: 14,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailLabel: {
    color: '#6B7280',
    fontSize: 13,
  },
  detailValue: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '700',
  },
  bannerExito: {
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  bannerExitoTexto: {
    color: '#065F46',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  bannerError: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  bannerErrorTitulo: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  bannerErrorTexto: {
    color: '#991B1B',
    fontSize: 13,
    lineHeight: 18,
  },
  downloadButton: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  downloadButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  descargandoContenido: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
