// src/app/(cajero)/escaner.tsx
//
// Escaneo de QR de retiro (INT4-8): integración de cámara (expo-camera) para
// escanear el código que genera el cliente (qr-retiro.tsx) y validar la
// entrega en el punto de retiro. Sigue el mockup (Cajero_Main → modal "QR
// Validado Correctamente"): se valida el payload QrRetiro contra el union
// EstadoOrden, se rechaza un QR ya usado (estado 'entregado') o de una orden
// cancelada y, al confirmar, se marca la orden como entregada contra el
// contrato real /v1/orders/{id}/entregar (ruta TODO: el gateway todavía no la
// rutea, igual que el listado de INT4-7).
//
// La cámara solo se monta mientras la pestaña está enfocada y no hay un
// resultado pendiente: expo-camera permite un único preview activo a la vez
// (docs: "unmount Camera components whenever a screen is unfocused").

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';

import { fetchPedidosEntrantes, marcarOrdenEntregada } from '../../services/ordenes';
import { parsearQrRetiro } from '../../services/qrRetiro';
import { getAccessToken, toApiError } from '../../services/httpClient';
import type { Orden, QrRetiro } from '../../types/domain';

function formatearMonto(monto: number): string {
  return `$${monto.toLocaleString('es-CL')}`;
}

// Resultado de procesar un código escaneado. 'error' muestra un banner con el
// motivo del rechazo; 'exito' abre el detalle de entrega (la orden es opcional:
// si el listado no cargó, la validación usa solo el payload del QR).
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
  const [permission, requestPermission] = useCameraPermissions();

  const [pedidos, setPedidos] = useState<Orden[]>([]);
  const [escaneando, setEscaneando] = useState(true);
  const [resultado, setResultado] = useState<ResultadoEscaneo | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [entregaConfirmada, setEntregaConfirmada] = useState(false);
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

  const manejarEscaneo = useCallback(
    (contenido: string) => {
      setEscaneando(false);
      setResultado(procesarCodigo(contenido, pedidos));
    },
    [pedidos]
  );

  const confirmarEntrega = useCallback(async () => {
    if (!resultado || resultado.tipo !== 'exito') {
      return;
    }

    setConfirmando(true);
    setErrorEntrega(null);
    try {
      await marcarOrdenEntregada(resultado.payload.pedido, getAccessToken() ?? '');
      setEntregaConfirmada(true);
    } catch (errorApi) {
      setErrorEntrega(toApiError(errorApi as never).message);
    } finally {
      setConfirmando(false);
    }
  }, [resultado]);

  const reiniciarEscaneo = useCallback(() => {
    setResultado(null);
    setEntregaConfirmada(false);
    setErrorEntrega(null);
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

  // --- 4. QR ya procesado (error). ---
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

  // --- 5. QR validado y entrega confirmada. ---
  if (entregaConfirmada && resultado?.tipo === 'exito') {
    return (
      <View style={styles.contenedor} testID="cajero-escaner-entrega-ok">
        <View style={styles.header}>
          <Text style={styles.headerTitulo}>Escanear QR de Retiro</Text>
          <Text style={styles.headerSubtitulo}>Valida el retiro en el punto de entrega</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkCircleTexto}>✓</Text>
          </View>
          <Text style={styles.cardTitulo}>Entrega registrada</Text>
          <Text style={styles.cardTexto}>
            La orden #{resultado.payload.pedido} fue marcada como entregada.
          </Text>
          <Pressable
            style={styles.botonPrimario}
            onPress={reiniciarEscaneo}
            testID="cajero-escaner-otro"
          >
            <Text style={styles.botonPrimarioTexto}>Escanear otro pedido</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- 6. QR validado: detalle de entrega (checklist de productos). ---
  if (resultado?.tipo === 'exito') {
    return (
      <ScrollView
        style={styles.contenedor}
        contentContainerStyle={styles.scrollContenido}
        testID="cajero-escaner-detalle"
      >
        <View style={styles.header}>
          <Text style={styles.headerTitulo}>Escanear QR de Retiro</Text>
          <Text style={styles.headerSubtitulo}>Valida el retiro en el punto de entrega</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkCircleTexto}>✓</Text>
          </View>
          <Text style={styles.cardTitulo}>QR Validado Correctamente</Text>
          <Text style={styles.cardTexto}>
            Entrega físicamente los siguientes productos al cliente:
          </Text>

          <View style={styles.ordenMeta}>
            <Text style={styles.ordenLabel}>N° DE PEDIDO</Text>
            <Text style={styles.ordenId}>#{resultado.payload.pedido}</Text>
            {resultado.orden?.clienteNombre ? (
              <Text style={styles.ordenCliente}>Cliente: {resultado.orden.clienteNombre}</Text>
            ) : null}
          </View>

          {resultado.orden && resultado.orden.items.length > 0 ? (
            <View style={styles.checklist}>
              {resultado.orden.items.map((item) => (
                <View key={item.ordenItemId} style={styles.itemPill}>
                  <Text style={styles.itemCantidad}>{item.cantidad}x</Text>
                  <Text style={styles.itemNombre}>{item.productoNombre}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {resultado.orden ? (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total pagado</Text>
              <Text style={styles.totalMonto}>{formatearMonto(resultado.orden.montoTotal)}</Text>
            </View>
          ) : null}

          {errorEntrega ? (
            <View style={styles.errorBanner} testID="cajero-escaner-error-entrega">
              <Text style={styles.errorTexto}>{errorEntrega}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.botonPrimario, confirmando && styles.botonDeshabilitado]}
            onPress={() => void confirmarEntrega()}
            disabled={confirmando}
            testID="cajero-escaner-confirmar"
          >
            <Text style={styles.botonPrimarioTexto}>
              {confirmando ? 'Registrando entrega…' : '✓ Confirmar entrega'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.botonSecundario}
            onPress={reiniciarEscaneo}
            testID="cajero-escaner-volver"
          >
            <Text style={styles.botonSecundarioTexto}>Volver a escanear</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // --- 7. Cámara activa esperando un QR. ---
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
  botonDeshabilitado: {
    opacity: 0.6,
  },
  botonSecundario: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 6,
  },
  botonSecundarioTexto: {
    color: '#0052CC',
    fontSize: 14,
    fontWeight: '700',
  },
  checkCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  checkCircleTexto: {
    color: '#166534',
    fontSize: 28,
    fontWeight: '800',
  },
  scrollContenido: {
    paddingBottom: 24,
  },
  ordenMeta: {
    alignSelf: 'stretch',
    backgroundColor: '#F8F5EF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  ordenLabel: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ordenId: {
    color: '#1D2433',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
  },
  ordenCliente: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 6,
  },
  checklist: {
    alignSelf: 'stretch',
    gap: 8,
    marginBottom: 12,
  },
  itemPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  itemCantidad: {
    color: '#0052CC',
    fontSize: 13,
    fontWeight: '800',
  },
  itemNombre: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 12,
    marginBottom: 14,
  },
  totalLabel: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  totalMonto: {
    color: '#1D2433',
    fontSize: 16,
    fontWeight: '800',
  },
  errorBanner: {
    alignSelf: 'stretch',
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorTexto: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
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
