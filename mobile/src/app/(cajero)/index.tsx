// src/app/(cajero)/index.tsx
//
// Pedidos entrantes del cajero (INT4-7). Diseño basado en el mockup
// (cloudcoffee-react/Cajero_Main → pestaña "Pedidos"): header con rol,
// buscador, chips de filtro y tarjetas de orden. Los filtros básicos son
// "Activos" (reservando + pagado) y "No retirados" (no_retirado_pendiente_revision
// + no_retirado_final), derivados del union EstadoOrden; los datos salen del
// contrato real (src/types/domain.ts): nada de estados inventados. Por defecto
// la cola muestra solo pedidos activos, como en el mockup.
//
// Búsqueda manual por código de orden (INT4-10): respaldo para ubicar una
// orden por su folio corto ante fallas de escaneo. Sigue el mockup (el input
// "O buscar folio corto (ej: CC-9801)" + botón "Validar" de Cajero_Main): al
// validar, navega a la misma pantalla de confirmación de entrega que el QR
// (confirmacion-entrega.tsx) o muestra el motivo del rechazo en la tarjeta.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { fetchPedidosEntrantes } from '../../services/ordenes';
import { getAccessToken, toApiError } from '../../services/httpClient';
import { useOrdenEstado } from '../../hooks/useOrdenEstado';
import { esEstadoOrdenActivo, esEstadoOrdenNoRetirado } from '../../types/domain';
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
    case 'pagado':
      return { etiqueta: '🔵 Pagado', fondo: '#DBEAFE', texto: '#1E40AF' };
    case 'listo_para_retiro':
      return { etiqueta: '🟢 Listo para Retiro', fondo: '#DCFCE7', texto: '#166534' };
    case 'entregado':
      return { etiqueta: '🟢 Entregado', fondo: '#DCFCE7', texto: '#166534' };
    case 'reservando':
      return { etiqueta: '⏳ Reservando', fondo: '#EFF6FF', texto: '#1D4ED8' };
    case 'no_retirado_pendiente_revision':
      return { etiqueta: '⚠️ No Retirado · Revisión', fondo: '#FEF3C7', texto: '#92400E' };
    case 'no_retirado_final':
      return { etiqueta: '⚠️ No Retirado', fondo: '#FEE2E2', texto: '#991B1B' };
    case 'cancelado':
      return { etiqueta: '✖ Cancelado', fondo: '#FEE2E2', texto: '#991B1B' };
  }
}

function FilaPedido({ orden }: { orden: Orden }) {
  const estadoEnVivo = useOrdenEstado(orden.ordenId);
  const estadoActual: EstadoOrden = estadoEnVivo ?? orden.estado;
  const visual = estadoVisual(estadoActual);

  return (
    <View style={styles.card} testID={`cajero-orden-${orden.ordenId}`}>
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

// Filtros del listado: categorías básicas (activos / no retirados) derivadas
// del union EstadoOrden, más el estado individual que el cajero elija.
type FiltroPedido = 'todos' | 'activos' | 'no_retirados' | EstadoOrden;

function cumpleFiltroEstado(estado: EstadoOrden, filtro: FiltroPedido): boolean {
  switch (filtro) {
    case 'todos':
      return true;
    case 'activos':
      return esEstadoOrdenActivo(estado);
    case 'no_retirados':
      return esEstadoOrdenNoRetirado(estado);
    default:
      return estado === filtro;
  }
}

// Resultado de la búsqueda manual por folio corto (INT4-10). Función pura: se
// exporta para testearla sin la pantalla, igual que procesarCodigo en el
// escáner (INT4-8). El estado de la orden siempre viene del union EstadoOrden,
// nunca de un string inventado en la pantalla.
export type ResultadoBusquedaManual =
  | { tipo: 'exito'; orden: Orden }
  | { tipo: 'no_encontrada'; codigo: string }
  | { tipo: 'ya_entregada'; codigo: string }
  | { tipo: 'cancelada'; codigo: string }
  | { tipo: 'vacia' };

export function buscarOrdenPorCodigo(pedidos: Orden[], texto: string): ResultadoBusquedaManual {
  const codigo = texto.trim();
  if (!codigo) {
    return { tipo: 'vacia' };
  }

  const normalizado = codigo.toLowerCase();
  const orden = pedidos.find(
    (pedido) =>
      pedido.codigoOrden.toLowerCase() === normalizado ||
      pedido.ordenId.toLowerCase() === normalizado
  );

  if (!orden) {
    return { tipo: 'no_encontrada', codigo };
  }

  // Mismo criterio que el escáner (procesarCodigo): una orden ya entregada o
  // cancelada no vuelve a confirmarse aunque el folio exista.
  if (orden.estado === 'entregado') {
    return { tipo: 'ya_entregada', codigo };
  }
  if (orden.estado === 'cancelado') {
    return { tipo: 'cancelada', codigo };
  }

  return { tipo: 'exito', orden };
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
      testID={testID ?? `cajero-chip-${etiqueta}`}
    >
      <Text style={[styles.chipText, activo && styles.chipTextActivo]}>{etiqueta}</Text>
    </Pressable>
  );
}

export default function PedidosEntrantesScreen() {
  const router = useRouter();
  const [pedidos, setPedidos] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroPedido>('activos');
  const [busqueda, setBusqueda] = useState('');

  // Búsqueda manual por folio corto (INT4-10): respaldo ante fallas de
  // escaneo. La validación es una función pura (buscarOrdenPorCodigo) para
  // testearla sin la pantalla.
  const [folioManual, setFolioManual] = useState('');
  const [mensajeManual, setMensajeManual] = useState<string | null>(null);

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

  // Valida el folio ingresado y navega a la confirmación de entrega (misma
  // ruta que el QR escaneado en escaner.tsx), o muestra el motivo del rechazo
  // en la tarjeta. El estado que viaja por params siempre es un valor del
  // union EstadoOrden tomado de la orden encontrada.
  const validarFolio = useCallback((): void => {
    const resultado = buscarOrdenPorCodigo(pedidos, folioManual);
    switch (resultado.tipo) {
      case 'exito':
        setMensajeManual(null);
        router.replace({
          pathname: '/(cajero)/confirmacion-entrega',
          params: { pedido: resultado.orden.ordenId, estado: resultado.orden.estado },
        });
        break;
      case 'vacia':
        setMensajeManual('Ingresa el folio o el código de la orden.');
        break;
      case 'no_encontrada':
        setMensajeManual(`No se encontró ninguna orden con el código/folio: ${resultado.codigo}`);
        break;
      case 'ya_entregada':
        setMensajeManual('Esta orden ya fue entregada.');
        break;
      case 'cancelada':
        setMensajeManual('El pedido fue cancelado y no puede entregarse.');
        break;
    }
  }, [pedidos, folioManual, router]);

  const estadosDisponibles = useMemo<EstadoOrden[]>(() => {
    const unicos = new Set<EstadoOrden>();
    pedidos.forEach((pedido) => unicos.add(pedido.estado));
    return Array.from(unicos);
  }, [pedidos]);

  const activosCount = useMemo(
    () => pedidos.filter((pedido) => esEstadoOrdenActivo(pedido.estado)).length,
    [pedidos]
  );

  const noRetiradosCount = useMemo(
    () => pedidos.filter((pedido) => esEstadoOrdenNoRetirado(pedido.estado)).length,
    [pedidos]
  );

  const query = busqueda.trim().toLowerCase();

  const pedidosFiltrados = useMemo<Orden[]>(() => {
    return pedidos.filter((pedido) => {
      const cumpleEstado = cumpleFiltroEstado(pedido.estado, filtro);
      const cumpleBusqueda =
        !query ||
        pedido.codigoOrden.toLowerCase().includes(query) ||
        pedido.ordenId.toLowerCase().includes(query) ||
        (pedido.clienteNombre ?? '').toLowerCase().includes(query);
      return cumpleEstado && cumpleBusqueda;
    });
  }, [pedidos, filtro, query]);

  const mensajeVacio = useMemo<string>(() => {
    if (pedidos.length === 0) {
      return 'No hay pedidos pendientes por ahora.';
    }
    switch (filtro) {
      case 'activos':
        return 'No hay pedidos activos por ahora.';
      case 'no_retirados':
        return 'No hay pedidos no retirados por ahora.';
      default:
        return 'No se encontraron pedidos con el filtro actual.';
    }
  }, [pedidos.length, filtro]);

  const cafeteriaNombre = pedidos.length > 0 ? pedidos[0].cafeteriaNombre : 'Cafetería';

  if (cargando && pedidos.length === 0) {
    return (
      <View style={styles.centrado} testID="cajero-cargando">
        <ActivityIndicator size="large" color="#0052CC" />
      </View>
    );
  }

  return (
    <View style={styles.contenedor}>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.rolePill}>POS Cajero</Text>
          <Text style={styles.headerTitulo}>{cafeteriaNombre}</Text>
        </View>
      </View>

      {/* Búsqueda manual por folio corto (INT4-10): respaldo ante fallas de
          escaneo, como el formulario "O buscar folio corto" del mockup. */}
      <View style={styles.folioCard} testID="cajero-folio-busqueda">
        <Text style={styles.folioTitulo}>🧾 Búsqueda manual por folio</Text>
        <Text style={styles.folioSubtitulo}>
          Respaldo ante fallas de escaneo: ingresa el folio corto de la orden.
        </Text>
        <View style={styles.folioFila}>
          <TextInput
            style={styles.folioInput}
            placeholder="O buscar folio corto (ej: CC-9801)"
            placeholderTextColor="#9CA3AF"
            value={folioManual}
            onChangeText={(texto) => {
              setFolioManual(texto);
              if (mensajeManual) {
                setMensajeManual(null);
              }
            }}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={validarFolio}
            testID="cajero-folio-input"
          />
          <Pressable
            style={styles.folioBoton}
            onPress={validarFolio}
            hitSlop={6}
            testID="cajero-folio-validar"
          >
            <Text style={styles.folioBotonTexto}>Validar</Text>
          </Pressable>
        </View>
        {mensajeManual ? (
          <View style={styles.folioError} testID="cajero-folio-error">
            <Text style={styles.folioErrorTexto}>{mensajeManual}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar cliente, folio o ID..."
          placeholderTextColor="#9CA3AF"
          value={busqueda}
          onChangeText={setBusqueda}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          testID="cajero-buscador"
        />
        {busqueda.length > 0 && (
          <Pressable onPress={() => setBusqueda('')} style={styles.clearButton} hitSlop={6}>
            <Text style={styles.clearButtonText}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
        <View style={styles.chips}>
          <ChipFiltro
            activo={filtro === 'todos'}
            etiqueta={`Todos (${pedidos.length})`}
            onPress={() => setFiltro('todos')}
            testID="cajero-filtro-todos"
          />
          <ChipFiltro
            activo={filtro === 'activos'}
            etiqueta={`Activos (${activosCount})`}
            onPress={() => setFiltro('activos')}
            testID="cajero-filtro-activos"
          />
          <ChipFiltro
            activo={filtro === 'no_retirados'}
            etiqueta={`No retirados (${noRetiradosCount})`}
            onPress={() => setFiltro('no_retirados')}
            testID="cajero-filtro-no-retirados"
          />
          {estadosDisponibles.map((estado) => (
            <ChipFiltro
              key={estado}
              activo={filtro === estado}
              etiqueta={`${estadoVisual(estado).etiqueta} (${
                pedidos.filter((pedido) => pedido.estado === estado).length
              })`}
              onPress={() => setFiltro(estado)}
            />
          ))}
        </View>
      </ScrollView>

      {error && (
        <View style={styles.errorBanner} testID="cajero-error">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={pedidosFiltrados}
        keyExtractor={(item) => item.ordenId}
        renderItem={({ item }) => <FilaPedido orden={item} />}
        contentContainerStyle={styles.listaContenido}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargarPedidos} />}
        ListEmptyComponent={
          error ? null : (
            <View style={styles.emptyState} testID="cajero-vacio">
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
  searchWrapper: {
    marginBottom: 10,
    justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingRight: 36,
    fontSize: 13,
    color: '#1D2433',
  },
  clearButton: {
    position: 'absolute',
    right: 12,
  },
  clearButtonText: {
    color: '#9CA3AF',
    fontSize: 15,
    fontWeight: '700',
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
  folioCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  folioTitulo: {
    color: '#1D2433',
    fontSize: 14,
    fontWeight: '800',
  },
  folioSubtitulo: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 17,
  },
  folioFila: {
    flexDirection: 'row',
    gap: 8,
  },
  folioInput: {
    flex: 1,
    backgroundColor: '#FAF7F2',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1D2433',
  },
  folioBoton: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  folioBotonTexto: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  folioError: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  folioErrorTexto: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '600',
  },
});
