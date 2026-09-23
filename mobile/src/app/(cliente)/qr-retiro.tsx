import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

export default function QrRetiroScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // hook para recibir el ID del pedido desde la pantalla de seguimientos
  const params = useLocalSearchParams();

  // Estados preparados para la integración con backend
  const [cargando, setCargando] = useState(true);
  const [ordenId, setOrdenId] = useState<string | null>(null);
  const [qrData, setQrData] = useState<string>('');

  useEffect(() => {
    const prepararDatosQR = async () => {
      try {
        // TODO: IMPLEMENTACIÓN REAL (Descomentar cuando el backend esté listo)
        // const id = params.id as string;
        // const detallesOrden = await apiService.obtenerDetallesOrden(id);
        // setOrdenId(detallesOrden.id);
        // setQrData(JSON.stringify({ pedido: detallesOrden.id, estado: detallesOrden.estado }));

        // --- SIMULACIÓN PARA LA DEMO ---
        await new Promise((resolve) => setTimeout(resolve, 800)); // Simula latencia de red
        const idSimulado = (params.id as string) || '1042';
        setOrdenId(idSimulado);
        setQrData(JSON.stringify({ pedido: idSimulado, estado: 'listo_para_retiro' }));
        // -------------------------------
      } catch (error) {
        console.error('Error al cargar datos del QR:', error);
      } finally {
        setCargando(false);
      }
    };

    prepararDatosQR();
  }, [params.id]);

  const handleDescargar = () => {
    // TODO: Implementar expo-sharing o expo-media-library para guardar la imagen en la galería
    alert('Próximamente: El QR se guardará en tu galería de fotos.');
  };

  if (cargando) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator size="large" color="#0284C7" />
        <Text style={styles.loadingText}>Generando código seguro...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Volver</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Código de Retiro</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.qrCard}>
          <Text style={styles.orderLabel}>TU PEDIDO ESTÁ LISTO</Text>
          <Text style={styles.orderId}>#{ordenId}</Text>

          <Text style={styles.instruction}>
            Presenta este código al barista en la caja para que escanee y te entregue tu pedido.
          </Text>

          <View style={styles.qrWrapper}>
            {qrData ? (
              <QRCode value={qrData} size={220} color="#2D1B14" backgroundColor="#FFFFFF" />
            ) : null}
          </View>
        </View>

        {/* Botón de Descarga */}
        <Pressable
          style={({ pressed }) => [styles.downloadButton, pressed && styles.buttonPressed]}
          onPress={handleDescargar}
        >
          <Text style={styles.downloadButtonText}>↓ Descargar QR</Text>
        </Pressable>
      </View>
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
    paddingTop: 32,
    alignItems: 'center',
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    shadowColor: '#2D1B14',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(229, 221, 211, 0.7)',
    marginBottom: 32,
  },
  orderLabel: {
    color: '#0284C7',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  orderId: {
    color: '#2D1B14',
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 16,
  },
  instruction: {
    color: '#7A7067',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
    paddingHorizontal: 10,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E5DDD3',
  },
  downloadButton: {
    backgroundColor: '#E5DDD3',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  downloadButtonText: {
    color: '#2D1B14',
    fontSize: 16,
    fontWeight: '700',
  },
});
