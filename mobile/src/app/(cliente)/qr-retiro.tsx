// src/app/(cliente)/qr-retiro.tsx
//
// Código QR de retiro (INT4-47). Rediseñado siguiendo el mockup de CÓDIGO DE
// RETIRO (cloudcoffee-react: Mi_Pedido): badge de seguimiento, tarjeta con el
// QR, pill de estado y botón de descarga.
//
// El QR codifica el payload QrRetiro (de src/types/domain.ts): el id de la
// orden y su estado, siempre un valor real del union EstadoOrden (nunca un
// string inventado). El id llega por params desde seguimientos; si no viene un
// estado válido se usa 'listo_para_retiro', el único estado desde el que
// tiene sentido presentar el código de retiro. La serialización del payload
// vive en src/services/qrRetiro.ts para que el cajero (escaner.tsx) consuma
// exactamente el mismo formato.
//
// El botón de descarga conserva su TODO (expo-sharing / expo-media-library).

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import { esEstadoOrden } from '../../types/domain';
import { serializarQrRetiro } from '../../services/qrRetiro';
import type { EstadoOrden, QrRetiro } from '../../types/domain';

function textoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

// Etiquetas de estado idénticas a las del mockup (🔵 Pagado / 🟢 Listo para
// retiro / ⚪ Entregado). Centralizadas acá para que la pantalla no mezcle
// formatos de estado según quién los mande.
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

export default function QrRetiroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams();
  const ordenId = textoUnico(params.id) ?? '';
  const estadoParam = textoUnico(params.estado);
  const estado: EstadoOrden = esEstadoOrden(estadoParam) ? estadoParam : 'listo_para_retiro';

  const payload: QrRetiro = { pedido: ordenId, estado };
  const qrValue = serializarQrRetiro(payload);

  const handleDescargar = () => {
    // TODO: Implementar expo-sharing o expo-media-library para guardar la imagen en la galería
    alert('Próximamente: El QR se guardará en tu galería de fotos.');
  };

  const abrirBoleta = () => {
    if (!ordenId) {
      return;
    }
    router.push({
      pathname: '/(cliente)/orden/[id]',
      params: { id: ordenId, estado },
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Código de Retiro</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!ordenId ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>☕</Text>
            <Text style={styles.emptyTitle}>No tienes pedidos activos</Text>
            <Text style={styles.emptyText}>
              Cuando realices una compra en el carrito, aquí verás tu código QR para el retiro.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>SEGUIMIENTO DE RETIRO</Text>
            </View>
            <Text style={styles.title}>Tu pedido está listo</Text>
            <Text style={styles.subtitle}>
              Presenta este código QR en la barra de la cafetería para retirar tu compra.
            </Text>

            <View style={styles.card}>
              <View style={styles.ticketTop}>
                <View>
                  <Text style={styles.orderLabel}>N° DE PEDIDO</Text>
                  <Text style={styles.orderId}>#{ordenId}</Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: clasePill(estado).fondo }]}>
                  <Text style={[styles.statusPillText, { color: clasePill(estado).texto }]}>
                    {etiquetaDeEstado(estado)}
                  </Text>
                </View>
              </View>

              <View style={styles.qrSection}>
                <View style={styles.qrWrapper}>
                  <QRCode value={qrValue} size={180} color="#0052CC" backgroundColor="#FFFFFF" />
                </View>
                <View style={styles.idPill}>
                  <Text style={styles.idPillText}>ID de orden: {ordenId}</Text>
                </View>
              </View>
            </View>

            <Pressable
              style={({ pressed }) => [styles.downloadButton, pressed && styles.buttonPressed]}
              onPress={handleDescargar}
            >
              <Text style={styles.downloadButtonText}>↓ Descargar QR</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.boletaButton, pressed && styles.buttonPressed]}
              onPress={abrirBoleta}
              testID="abrir-boleta"
            >
              <Text style={styles.boletaButtonText}>📄 Ver Boleta en PDF</Text>
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
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
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
