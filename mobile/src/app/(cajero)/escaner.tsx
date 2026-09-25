// src/app/(cajero)/escaner.tsx
//
// Escaneo de QR de retiro (INT4-8): integración de cámara (expo-camera) para
// escanear el código que genera el cliente (qr-retiro.tsx) y validar la
// entrega en el punto de retiro. Se valida el payload QrRetiro contra el union
// EstadoOrden y se rechaza un QR ya usado (estado 'entregado') o de una orden
// cancelada. Al validar, se navega a la pantalla de confirmación de entrega
// (confirmacion-entrega.tsx, INT4-9), que muestra el detalle de ítems a
// entregar y confirma contra POST /v1/orders/{id}/entregar.
//
// La cámara solo se monta mientras la pestaña está enfocada y no hay un
// resultado pendiente: expo-camera permite un único preview activo a la vez
// (docs: "unmount Camera components whenever a screen is unfocused").

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';

import { fetchPedidosEntrantes } from '../../services/ordenes';
import { parsearQrRetiro } from '../../services/qrRetiro';
import { getAccessToken } from '../../services/httpClient';
import type { Orden, QrRetiro } from '../../types/domain';

// Resultado de procesar un código escaneado. 'error' muestra un banner con el
// motivo del rechazo; 'exito' navega a la pantalla de confirmación de entrega
// (la orden es opcional: si el listado no cargó, la validación usa el payload).
export type ResultadoEscaneo =
  { tipo: 'error'; mensaje: string } | { tipo: 'exito'; payload: QrRetiro; orden?: Orden };

// Valida el contenido escaneado contra el contrato QrRetiro y el listado de
// pedidos (si está disponible). Función pura: se exporta para testearla sin
// la cámara.
export function procesarCodigo(contenido: string, pedidos: Orden[]): ResultadoEscaneo {
  const payload = parsearQrRetiro(contenido);
  if (!payload) {
    return { tipo: 'error', mensaje: 'El código escaneado no es un QR de retiro válido.' };
  }

  const orden = pedidos.find((pedido) => pedido.ordenId === payload.pedido);

  if (payload.estado === 'entregado' || orden?.estado === 'entregado') {
    return { tipo: 'error', mensaje: 'Este código QR ya fue utilizado anteriormente.' };
  }

  if (payload.estado === 'cancelado' || orden?.estado === 'cancelado') {
    return { tipo: 'error', mensaje: 'El pedido fue cancelado y no puede entregarse.' };
  }

  return { tipo: 'exito', payload, orden };
}

export default function EscanerQRScreen() {
  const estaFocada = useIsFocused();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();

  const [pedidos, setPedidos] = useState<Orden[]>([]);
  const [escaneando, setEscaneando] = useState(true);
  const [resultado, setResultado] = useState<ResultadoEscaneo | null>(null);
  const [torchEncendida, setTorchEncendida] = useState(false);

  // Carga auxiliar del listado para enriquecer la validación con los datos de
  // la orden (cliente, ítems, total). Si el backend todavía no responde (ver
  // TODO en ordenes.ts), la validación funciona igual con el payload.
  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchPedidosEntrantes(getAccessToken() ?? '');
        setPedidos(data);
      } catch {
        // Sin listado: se valida solo con el QR escaneado.
      }
    })();
  }, []);

  // Al recuperar el foco de la pestaña vuelve a activar la cámara y limpia
  // cualquier estado anterior (QR inválido o vuelta desde la confirmación).
  useFocusEffect(
    useCallback(() => {
      setResultado(null);
      setEscaneando(true);
    }, [])
  );

  const manejarEscaneo = useCallback(
    (contenido: string) => {
      setEscaneando(false);
      const validado = procesarCodigo(contenido, pedidos);
      if (validado.tipo === 'error') {
        setResultado(validado);
        return;
      }
      // QR válido: el detalle de ítems a entregar vive en su propia pantalla
      // (INT4-9), así que el escáner solo valida y navega.
      router.replace({
        pathname: '/(cajero)/confirmacion-entrega',
        params: {
          pedido: validado.payload.pedido,
          estado: validado.payload.estado,
        },
      });
    },
    [pedidos, router]
  );

  const reiniciarEscaneo = useCallback(() => {
    setResultado(null);
    setEscaneando(true);
  }, []);

  // --- 1. Los permisos de cámara todavía se están leyendo. ---
  if (!permission) {
    return (
      <View style={styles.centrado} testID="cajero-escaner-cargando">
        <ActivityIndicator size="large" color="#0052CC" />
      </View>
    );
  }

  // --- 2. Sin permiso de cámara. ---
  if (!permission.granted) {
    return (
      <View style={styles.contenedor} testID="cajero-escaner-permiso">
        <View style={styles.header}>
          <Text style={styles.headerTitulo}>Escanear QR de Retiro</Text>
          <Text style={styles.headerSubtitulo}>Valida el retiro en el punto de entrega</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardIcono}>📷</Text>
          <Text style={styles.cardTitulo}>Permiso de cámara requerido</Text>
          <Text style={styles.cardTexto}>
            Para escanear el código QR de retiro, otorga acceso a la cámara del dispositivo.
          </Text>
          <Pressable
            style={styles.botonPrimario}
            onPress={() => void requestPermission()}
            testID="cajero-escaner-pedir-permiso"
          >
            <Text style={styles.botonPrimarioTexto}>Solicitar permiso de cámara</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- 3. La pestaña no está enfocada: la cámara no debe estar activa. ---
  if (!estaFocada) {
    return <View style={styles.contenedor} testID="cajero-escaner-inactivo" />;
  }

  // --- 4. QR procesado con error. ---
  if (resultado?.tipo === 'error') {
    return (
      <View style={styles.contenedor} testID="cajero-escaner-error">
        <View style={styles.header}>
          <Text style={styles.headerTitulo}>Escanear QR de Retiro</Text>
          <Text style={styles.headerSubtitulo}>Valida el retiro en el punto de entrega</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardIcono}>⚠️</Text>
          <Text style={styles.cardTitulo}>QR no válido</Text>
          <Text style={styles.cardTexto}>{resultado.mensaje}</Text>
          <Pressable
            style={styles.botonPrimario}
            onPress={reiniciarEscaneo}
            testID="cajero-escaner-reintentar"
          >
            <Text style={styles.botonPrimarioTexto}>Volver a escanear</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- 5. Cámara activa esperando un QR. ---
  return (
    <View style={styles.cameraPantalla} testID="cajero-escaner-camara">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torchEncendida}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (!escaneando) {
            return;
          }
          manejarEscaneo(data);
        }}
        testID="cajero-camara"
      />
      <View style={styles.overlaySuperior}>
        <Text style={styles.overlayTitulo}>Escanear QR de Retiro</Text>
        <Text style={styles.overlaySubtitulo}>
          Pide al cliente el código QR de su pedido y apúntale la cámara.
        </Text>
        <View style={styles.marcoEscaneo} />
      </View>
      <Pressable
        style={styles.torchButton}
        onPress={() => setTorchEncendida((actual) => !actual)}
        testID="cajero-escaner-linterna"
      >
        <Text style={styles.torchTexto}>{torchEncendida ? '🔦 Apagar' : '🔦 Linterna'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: '#FAF7F2',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  centrado: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF7F2',
  },
  header: {
    marginBottom: 12,
  },
  headerTitulo: {
    color: '#1D2433',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitulo: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardIcono: {
    fontSize: 34,
    marginBottom: 8,
  },
  cardTitulo: {
    color: '#1D2433',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  cardTexto: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  botonPrimario: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  botonPrimarioTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  cameraPantalla: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
  overlaySuperior: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 28,
    paddingHorizontal: 24,
  },
  overlayTitulo: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    textShadowColor: '#00000066',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  overlaySubtitulo: {
    color: '#E5E7EB',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    textShadowColor: '#00000066',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  marcoEscaneo: {
    marginTop: 40,
    width: 220,
    height: 220,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: 20,
    backgroundColor: '#00000022',
  },
  torchButton: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    backgroundColor: '#00000088',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  torchTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
