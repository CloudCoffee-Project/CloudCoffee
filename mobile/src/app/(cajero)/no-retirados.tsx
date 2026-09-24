// src/app/(cajero)/no-retirados.tsx
//
// Listado de órdenes no retiradas pendientes (INT4-11). Reemplaza el
// placeholder con la pestaña "No Retirados" del mockup (cloudcoffee-react →
// Cajero_Main → sección 3.2.6 "Órdenes no retiradas pendientes de revisión"):
// tarjetas de órdenes con los estados no_retirado_pendiente_revision y
// no_retirado_final (siempre valores del union EstadoOrden, derivados con
// esEstadoOrdenNoRetirado), un chip para separar "Pendientes de revisión" de
// las "Finales", y el badge de estado por tarjeta.
//
// El mockup también muestra el filtro por fecha y las acciones por ítem
// (reingresar/descartar) con su confirmación: esas acciones son de otra tarea,
// y el filtro por fecha no aplica aún porque el contrato Orden no trae fecha
// (nada de campos inventados, ver src/types/domain.ts). Las acciones por
// ítem y la resolución quedan para la pantalla de detalle correspondiente.

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { fetchPedidosEntrantes } from '../../services/ordenes';
import { getAccessToken, toApiError } from '../../services/httpClient';
import { useOrdenEstado } from '../../hooks/useOrdenEstado';
import { esEstadoOrdenNoRetirado } from '../../types/domain';
import type { EstadoOrden, Orden } from '../../types/domain';

function formatearMonto(monto: number): string {
  return `$${monto.toLocaleString('es-CL')}`;
}

interface EstadoVisual {
  etiqueta: string;
  fondo: string;
  texto: string;
}

function estadoVisual(estado: EstadoOrden): EstadoVisual {
  switch (estado) {
    case 'no_retirado_pendiente_revision':
      return { etiqueta: '⚠️ No Retirado · Revisión', fondo: '#FEF3C7', texto: '#92400E' };
    case 'no_retirado_final':
      return { etiqueta: '⚠️ No Retirado', fondo: '#FEE2E2', texto: '#991B1B' };
    default:
      // Por construcción la lista solo muestra estados no retirados; este
      // caso defiende el badge sin inventar un string de estado.
      return { etiqueta: `⚠️ No Retirado (${estado})`, fondo: '#FEE2E2', texto: '#991B1B' };
  }
}

function FilaNoRetirado({ orden }: { orden: Orden }) {
  const estadoEnVivo = useOrdenEstado(orden.ordenId);
  const estadoActual: EstadoOrden = estadoEnVivo ?? orden.estado;
  const visual = estadoVisual(estadoActual);

  return (
    <View style={styles.card} testID={`cajero-no-retirado-${orden.ordenId}`}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderInfo}>
          <Text style={styles.cardCodigo}>{orden.codigoOrden}</Text>
          <Text style={styles.cardOrdenId}>ID: {orden.ordenId}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: visual.fondo }]}>
          <Text style={[styles.badgeText, { color: visual.texto }]}>{visual.etiqueta}</Text>
        </View>
      </View>

      {orden.clienteNombre ? (
        <View style={styles.clienteRow}>
          <Text style={styles.clienteNombre}>👤 {orden.clienteNombre}</Text>
        </View>
      ) : null}

      <View style={styles.items}>
        {orden.items.map((item) => (
          <View key={item.ordenItemId} style={styles.itemRow}>
            <Text style={styles.itemNombre}>
              {item.cantidad}x {item.productoNombre}
            </Text>
            <Text style={styles.itemPrecio}>
              {formatearMonto(item.precioUnitario * item.cantidad)}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.footerLabel}>Total pagado</Text>
        <Text style={styles.footerMonto}>{formatearMonto(orden.montoTotal)}</Text>
      </View>
    </View>
  );
}

// Chips de la pestaña: "Pendientes de revisión" (no_retirado_pendiente_revision)
// y "Finales" (no_retirado_final), más el acceso a todas. Derivadas del union
// EstadoOrden, nunca de strings planos.
type FiltroNoRetirado = 'todos' | 'revision' | 'final';

function cumpleFiltro(estado: EstadoOrden, filtro: FiltroNoRetirado): boolean {
  switch (filtro) {
    case 'todos':
      return true;
    case 'revision':
      return estado === 'no_retirado_pendiente_revision';
    case 'final':
      return estado === 'no_retirado_final';
  }
}

interface PropsChipFiltro {
  activo: boolean;
  etiqueta: string;
  onPress: () => void;
  testID?: string;
}

function ChipFiltro({ activo, etiqueta, onPress, testID }: PropsChipFiltro) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, activo && styles.chipActivo]}
      hitSlop={6}
      testID={testID ?? `cajero-nr-chip-${etiqueta}`}
    >
      <Text style={[styles.chipText, activo && styles.chipTextActivo]}>{etiqueta}</Text>
    </Pressable>
  );
}

export default function NoRetiradosScreen() {
  const [pedidos, setPedidos] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroNoRetirado>('todos');

  async function cargarPedidos(): Promise<void> {
    try {
      const data = await fetchPedidosEntrantes(getAccessToken() ?? '');
      setPedidos(data);
      setError(null);
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial de datos, patrón válido
    void cargarPedidos();
  }, []);

  // El listado filtra por el estado base de la Orden (igual que la pestaña
  // Pedidos); el badge de cada tarjeta muestra el estado en vivo por
  // WebSocket cuando llega (useOrdenEstado).
  const noRetirados = useMemo<Orden[]>(
    () => pedidos.filter((pedido) => esEstadoOrdenNoRetirado(pedido.estado)),
    [pedidos]
  );

  const revisionCount = useMemo(
    () => pedidos.filter((pedido) => pedido.estado === 'no_retirado_pendiente_revision').length,
    [pedidos]
  );

  const finalCount = useMemo(
    () => pedidos.filter((pedido) => pedido.estado === 'no_retirado_final').length,
    [pedidos]
  );

  const pedidosFiltrados = useMemo<Orden[]>(
    () => noRetirados.filter((pedido) => cumpleFiltro(pedido.estado, filtro)),
    [noRetirados, filtro]
  );

  const mensajeVacio = useMemo<string>(() => {
    if (noRetirados.length === 0) {
      return 'No hay órdenes no retiradas por ahora.';
    }
    switch (filtro) {
      case 'revision':
        return 'No hay órdenes no retiradas pendientes de revisión.';
      case 'final':
        return 'No hay órdenes no retiradas con resolución final.';
      default:
        return 'No hay órdenes no retiradas pendientes para esta cafetería.';
    }
  }, [noRetirados.length, filtro]);

  const cafeteriaNombre = pedidos.length > 0 ? pedidos[0].cafeteriaNombre : 'Cafetería';

  if (cargando && pedidos.length === 0) {
    return (
      <View style={styles.centrado} testID="cajero-nr-cargando">
        <ActivityIndicator size="large" color="#0052CC" />
      </View>
    );
  }

  return (
    <View style={styles.contenedor}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.rolePill}>POS Cajero</Text>
          <Text style={styles.headerTitulo}>No Retirados · {cafeteriaNombre}</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
        <View style={styles.chips}>
          <ChipFiltro
            activo={filtro === 'todos'}
            etiqueta={`Todas (${noRetirados.length})`}
            onPress={() => setFiltro('todos')}
            testID="cajero-nr-chip-todos"
          />
          <ChipFiltro
            activo={filtro === 'revision'}
            etiqueta={`Revisión (${revisionCount})`}
            onPress={() => setFiltro('revision')}
            testID="cajero-nr-chip-revision"
          />
          <ChipFiltro
            activo={filtro === 'final'}
            etiqueta={`Finales (${finalCount})`}
            onPress={() => setFiltro('final')}
            testID="cajero-nr-chip-final"
          />
        </View>
      </ScrollView>

      {error && (
        <View style={styles.errorBanner} testID="cajero-nr-error">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={pedidosFiltrados}
        keyExtractor={(item) => item.ordenId}
        renderItem={({ item }) => <FilaNoRetirado orden={item} />}
        contentContainerStyle={styles.listaContenido}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargarPedidos} />}
        ListEmptyComponent={
          error ? null : (
            <View style={styles.emptyState} testID="cajero-nr-vacio">
              <Text style={styles.emptyText}>{mensajeVacio}</Text>
            </View>
          )
        }
      />
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  headerInfo: {
    gap: 4,
  },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    color: '#92400E',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  headerTitulo: {
    color: '#0052CC',
    fontSize: 17,
    fontWeight: '800',
  },
  chipsScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  chips: {
    flexDirection: 'row',
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  chipActivo: {
    backgroundColor: '#0052CC',
    borderColor: '#0052CC',
  },
  chipText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '700',
  },
  chipTextActivo: {
    color: '#FFFFFF',
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '600',
  },
  listaContenido: {
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardHeaderInfo: {
    flex: 1,
    gap: 2,
  },
  cardCodigo: {
    color: '#1D2433',
    fontSize: 15,
    fontWeight: '800',
  },
  cardOrdenId: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '500',
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  clienteRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
    borderStyle: 'dashed',
    paddingBottom: 8,
  },
  clienteNombre: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  items: {
    gap: 4,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  itemNombre: {
    flex: 1,
    color: '#1D2433',
    fontSize: 13,
  },
  itemPrecio: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '700',
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLabel: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  footerMonto: {
    color: '#1D2433',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 13,
    textAlign: 'center',
  },
});
