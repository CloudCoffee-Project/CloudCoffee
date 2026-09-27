// src/app/(cajero)/confirmacion-entrega.tsx
//
// Pantalla de confirmación de entrega (INT4-9): detalle de ítems a entregar
// tras validar el QR de retiro. Sigue el mockup (cloudcoffee-react →
// Cajero_Main → modal "QR Validado Correctamente"): check, título, meta de la
// orden con cliente, checklist de productos y total.
//
// Recibe por params el payload del QR ya validado por el escáner (escaner.tsx):
// `pedido` (id de la orden) y `estado` (siempre un valor del union
// EstadoOrden). Enriquece el detalle consultando el listado de pedidos
// (cliente, ítems, total); si el listado no responde, la pantalla funciona
// igual con el payload. Al confirmar, marca la orden como entregada contra
// POST /v1/orders/{id}/entregar (mismo contrato TODO que INT4-7/INT4-8: la
// ruta aún no está ruteada por el gateway).

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { fetchPedidosEntrantes, marcarOrdenEntregada } from '../../services/ordenes';
import { getAccessToken, toApiError } from '../../services/httpClient';
import { esEstadoOrden } from '../../types/domain';
import type { Orden } from '../../types/domain';

function formatearMonto(monto: number): string {
  return `$${monto.toLocaleString('es-CL')}`;
}

function textoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default function ConfirmacionEntregaScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const pedido = textoUnico(params.pedido) ?? '';
  const estadoValido = esEstadoOrden(textoUnico(params.estado));

  const [orden, setOrden] = useState<Orden | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [entregada, setEntregada] = useState(false);

  // Enriquece con los datos de la orden (cliente, ítems, total). Si el
  // listado no responde (backend aún sin /v1/orders), se muestra la orden
  // con la información del QR escaneado.
  useEffect(() => {
    let activo = true;
    void (async () => {
      try {
        const data = await fetchPedidosEntrantes(getAccessToken() ?? '');
        if (!activo) {
          return;
        }
        setOrden(data.find((p) => p.ordenId === pedido) ?? null);
      } catch {
        // Sin listado: se valida solo con el QR escaneado.
      }
    })();
    return () => {
      activo = false;
    };
  }, [pedido]);

  const volverAlEscaner = useCallback(() => {
    router.replace('/(cajero)/escaner');
  }, [router]);

  const confirmarEntrega = useCallback(async () => {
    setConfirmando(true);
    setErrorEntrega(null);
    try {
      await marcarOrdenEntregada(pedido, getAccessToken() ?? '');
      setEntregada(true);
    } catch (errorApi) {
      setErrorEntrega(toApiError(errorApi as never).message);
    } finally {
      setConfirmando(false);
    }
  }, [pedido]);

  // Defensivo: el escáner valida el payload antes de navegar, pero esta
  // pantalla también puede abrirse con params inválidos desde la URL.
  if (!pedido || !estadoValido) {
    return (
      <View style={styles.contenedor} testID="cajero-confirmacion-invalida">
        <View style={styles.header}>
          <Text style={styles.headerTitulo}>Confirmación de entrega</Text>
          <Text style={styles.headerSubtitulo}>Verifica los productos antes de entregar</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardIcono}>⚠️</Text>
          <Text style={styles.cardTitulo}>QR no válido</Text>
          <Text style={styles.cardTexto}>
            El código escaneado no corresponde a un retiro válido.
          </Text>
          <Pressable
            style={styles.botonPrimario}
            onPress={volverAlEscaner}
            testID="cajero-confirmacion-volver-escaner"
          >
            <Text style={styles.botonPrimarioTexto}>Volver a escanear</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Entrega confirmada contra el backend.
  if (entregada) {
    return (
      <View style={styles.contenedor} testID="cajero-confirmacion-entregada">
        <View style={styles.header}>
          <Text style={styles.headerTitulo}>Confirmación de entrega</Text>
          <Text style={styles.headerSubtitulo}>Verifica los productos antes de entregar</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkCircleTexto}>✓</Text>
          </View>
          <Text style={styles.cardTitulo}>Entrega registrada</Text>
          <Text style={styles.cardTexto}>La orden #{pedido} fue marcada como entregada.</Text>
          <Pressable
            style={styles.botonPrimario}
            onPress={volverAlEscaner}
            testID="cajero-confirmacion-otro"
          >
            <Text style={styles.botonPrimarioTexto}>Escanear otro pedido</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // QR validado: detalle con el checklist de ítems a entregar.
  return (
    <ScrollView
      style={styles.contenedor}
      contentContainerStyle={styles.scrollContenido}
      testID="cajero-confirmacion-detalle"
    >
      <View style={styles.header}>
        <Text style={styles.headerTitulo}>Confirmación de entrega</Text>
        <Text style={styles.headerSubtitulo}>Verifica los productos antes de entregar</Text>
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
          <Text style={styles.ordenId}>#{pedido}</Text>
          {orden?.clienteNombre ? (
            <Text style={styles.ordenCliente}>Cliente: {orden.clienteNombre}</Text>
          ) : null}
        </View>

        {orden && orden.items.length > 0 ? (
          <View style={styles.checklist}>
            {orden.items.map((item) => (
              <View key={item.ordenItemId} style={styles.itemPill}>
                <Text style={styles.itemCantidad}>{item.cantidad}x</Text>
                <Text style={styles.itemNombre}>{item.productoNombre}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {orden ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total pagado</Text>
            <Text style={styles.totalMonto}>{formatearMonto(orden.montoTotal)}</Text>
          </View>
        ) : null}

        {errorEntrega ? (
          <View style={styles.errorBanner} testID="cajero-confirmacion-error-entrega">
            <Text style={styles.errorTexto}>{errorEntrega}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.botonPrimario, confirmando && styles.botonDeshabilitado]}
          onPress={() => void confirmarEntrega()}
          disabled={confirmando}
          testID="cajero-confirmacion-confirmar"
        >
          <Text style={styles.botonPrimarioTexto}>
            {confirmando ? 'Registrando entrega…' : '✓ Confirmar entrega'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.botonSecundario}
          onPress={volverAlEscaner}
          testID="cajero-confirmacion-volver"
        >
          <Text style={styles.botonSecundarioTexto}>Volver a escanear</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
    backgroundColor: '#FAF7F2',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  scrollContenido: {
    paddingBottom: 24,
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
});
