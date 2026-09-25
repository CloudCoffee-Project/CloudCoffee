// src/app/(cajero)/no-retirados.tsx
//
// Listado de órdenes no retiradas pendientes (INT4-11) y flujo de decisión ítem
// por ítem (INT4-12). Reemplaza el placeholder con la pestaña "No Retirados"
// del mockup (cloudcoffee-react → Cajero_Main → sección 3.2.6 "Órdenes no
// retiradas pendientes de revisión"):
//
//   - Tarjetas de órdenes con los estados no_retirado_pendiente_revision y
//     no_retirado_final (siempre valores del union EstadoOrden, derivados con
//     esEstadoOrdenNoRetirado), un chip para separar "Pendientes de revisión"
//     de las "Finales", y el badge de estado por tarjeta (INT4-11).
//   - En las órdenes pendientes de revisión: "Decide la acción individual para
//     cada ítem" con ♻️ Reingresar Stock / 🗑️ Descartar por ítem y el botón
//     "✓ Confirmar Revisión de Orden" (INT4-12). Confirmar llama a
//     resolverOrdenNoRetirada; cada ítem debe tener una acción antes de
//     confirmar (mismo mensaje de validación que el mockup).
//
// El mockup también muestra el filtro por fecha: no aplica aún porque el
// contrato Orden no trae fecha (nada de campos inventados, ver
// src/types/domain.ts). Las acciones solo aparecen en órdenes pendientes de
// revisión; las finales se muestran solo lectura.

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

import { fetchPedidosEntrantes, resolverOrdenNoRetirada } from '../../services/ordenes';
import { getAccessToken, toApiError } from '../../services/httpClient';
import { useOrdenEstado } from '../../hooks/useOrdenEstado';
import { esEstadoOrdenNoRetirado } from '../../types/domain';
import type { AccionNoRetirado, EstadoOrden, Orden } from '../../types/domain';

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

interface PropsFilaNoRetirado {
  orden: Orden;
  decisiones: Record<string, AccionNoRetirado>;
  onCambiarDecision: (ordenItemId: string, accion: AccionNoRetirado) => void;
  resolviendo: boolean;
  error: string | null;
  onConfirmar: () => void;
}

function FilaNoRetirado({
  orden,
  decisiones,
  onCambiarDecision,
  resolviendo,
  error,
  onConfirmar,
}: PropsFilaNoRetirado) {
  const estadoEnVivo = useOrdenEstado(orden.ordenId);
  const estadoActual: EstadoOrden = estadoEnVivo ?? orden.estado;
  const visual = estadoVisual(estadoActual);
  // El flujo de decisión pertenece a las órdenes pendientes de revisión; las
  // finales se muestran solo lectura en la misma tarjeta.
  const pendienteRevision = orden.estado === 'no_retirado_pendiente_revision';

  return (
    <View style={styles.card} testID={`cajero-no-retirado-${orden.ordenId}`}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderInfo}>
          <Text style={styles.cardCodigo}>{orden.codigoOrden}</Text>
          <Text style={styles.cardOrdenId}>ID: {orden.ordenId}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: visual.fondo }]}>
          <Text
            style={[styles.badgeText, { color: visual.texto }]}
            testID={`cajero-nr-badge-${orden.ordenId}`}
          >
            {visual.etiqueta}
          </Text>
        </View>
      </View>

      {orden.clienteNombre ? (
        <View style={styles.clienteRow}>
          <Text style={styles.clienteNombre}>👤 {orden.clienteNombre}</Text>
        </View>
      ) : null}

      {pendienteRevision && (
        <Text style={styles.instruccion}>Decide la acción individual para cada ítem:</Text>
      )}

      <View style={styles.items}>
        {orden.items.map((item) => (
          <View key={item.ordenItemId} style={styles.itemBloque}>
            <View style={styles.itemRow}>
              <Text style={styles.itemNombre}>
                {item.cantidad}x {item.productoNombre}
              </Text>
              <Text style={styles.itemPrecio}>
                {formatearMonto(item.precioUnitario * item.cantidad)}
              </Text>
            </View>
            {pendienteRevision && (
              <View style={styles.itemAcciones}>
                <Pressable
                  onPress={() => onCambiarDecision(item.ordenItemId, 'reingresar')}
                  style={[
                    styles.btnAccion,
                    decisiones[item.ordenItemId] === 'reingresar' && styles.btnAccionReingresar,
                  ]}
                  testID={`cajero-nr-accion-${item.ordenItemId}-reingresar`}
                >
                  <Text
                    style={[
                      styles.btnAccionText,
                      decisiones[item.ordenItemId] === 'reingresar' &&
                        styles.btnAccionTextReingresar,
                    ]}
                  >
                    ♻️ Reingresar Stock
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onCambiarDecision(item.ordenItemId, 'descartar')}
                  style={[
                    styles.btnAccion,
                    decisiones[item.ordenItemId] === 'descartar' && styles.btnAccionDescartar,
                  ]}
                  testID={`cajero-nr-accion-${item.ordenItemId}-descartar`}
                >
                  <Text
                    style={[
                      styles.btnAccionText,
                      decisiones[item.ordenItemId] === 'descartar' && styles.btnAccionTextDescartar,
                    ]}
                  >
                    🗑️ Descartar
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </View>

      {pendienteRevision && (
        <View style={styles.accionesOrden}>
          <Pressable
            onPress={onConfirmar}
            disabled={resolviendo}
            style={[styles.btnConfirmar, resolviendo && styles.btnDeshabilitado]}
            testID={`cajero-nr-confirmar-${orden.ordenId}`}
          >
            {resolviendo ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.btnConfirmarText}>✓ Confirmar Revisión de Orden</Text>
            )}
          </Pressable>
          {error && (
            <View style={styles.errorBanner} testID={`cajero-nr-error-${orden.ordenId}`}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </View>
      )}

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

// Mensaje de validación del mockup (Cajero_Main.jsx, handleResolverOrdenNoRetirada).
const MENSAJE_FALTAN_ACCIONES =
  'Debes seleccionar una acción (Reingresar o Descartar) para cada ítem antes de confirmar.';

export default function NoRetiradosScreen() {
  const [pedidos, setPedidos] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroNoRetirado>('todos');

  // Estado del flujo INT4-12: decisión por ítem (clave = ordenItemId), orden
  // que se está confirmando y errores de validación/API por orden.
  const [decisiones, setDecisiones] = useState<Record<string, AccionNoRetirado>>({});
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  const [erroresOrden, setErroresOrden] = useState<Record<string, string>>({});
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

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

  function cambiarDecision(ordenItemId: string, accion: AccionNoRetirado): void {
    setDecisiones((prev) => ({ ...prev, [ordenItemId]: accion }));
    // Una nueva decisión limpia el error de validación de su orden.
    const duenio = pedidos.find((p) => p.items.some((it) => it.ordenItemId === ordenItemId));
    if (duenio) {
      setErroresOrden((prev) => {
        if (!prev[duenio.ordenId]) {
          return prev;
        }
        const next = { ...prev };
        delete next[duenio.ordenId];
        return next;
      });
    }
  }

  async function confirmarRevision(orden: Orden): Promise<void> {
    // Una orden a la vez (patrón del mockup: alert de validación por orden).
    if (resolviendo) {
      return;
    }

    const decisionesOrden = orden.items.map((it) => ({
      ordenItemId: it.ordenItemId,
      accion: decisiones[it.ordenItemId],
    }));
    const faltaAlguna = decisionesOrden.some((d) => !d.accion);
    if (faltaAlguna) {
      setErroresOrden((prev) => ({ ...prev, [orden.ordenId]: MENSAJE_FALTAN_ACCIONES }));
      return;
    }

    setResolviendo(orden.ordenId);
    setErroresOrden((prev) => {
      const next = { ...prev };
      delete next[orden.ordenId];
      return next;
    });

    try {
      const decisionesTipadas = decisionesOrden.map((d) => ({
        ordenItemId: d.ordenItemId,
        accion: d.accion as AccionNoRetirado,
      }));
      await resolverOrdenNoRetirada(orden.ordenId, decisionesTipadas, getAccessToken() ?? '');

      // Éxito: la orden sale del listado y se informa el resumen por ítem.
      const reingresar = decisionesTipadas.filter((d) => d.accion === 'reingresar').length;
      const descartar = decisionesTipadas.filter((d) => d.accion === 'descartar').length;
      setMensajeExito(
        `Orden ${orden.codigoOrden} procesada: ${reingresar} ítem(s) reingresado(s) al stock, ${descartar} descartado(s).`
      );
      setPedidos((prev) => prev.filter((p) => p.ordenId !== orden.ordenId));
      setDecisiones((prev) => {
        const next = { ...prev };
        orden.items.forEach((it) => delete next[it.ordenItemId]);
        return next;
      });
    } catch (errorApi) {
      setErroresOrden((prev) => ({
        ...prev,
        [orden.ordenId]: toApiError(errorApi as never).message,
      }));
    } finally {
      setResolviendo(null);
    }
  }

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

      {mensajeExito && (
        <View style={styles.exitoBanner} testID="cajero-nr-exito">
          <Text style={styles.exitoText}>{mensajeExito}</Text>
          <Pressable
            onPress={() => setMensajeExito(null)}
            hitSlop={8}
            testID="cajero-nr-cerrar-exito"
          >
            <Text style={styles.exitoCerrar}>✕</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={pedidosFiltrados}
        keyExtractor={(item) => item.ordenId}
        renderItem={({ item }) => (
          <FilaNoRetirado
            orden={item}
            decisiones={decisiones}
            onCambiarDecision={cambiarDecision}
            resolviendo={resolviendo === item.ordenId}
            error={erroresOrden[item.ordenId] ?? null}
            onConfirmar={() => void confirmarRevision(item)}
          />
        )}
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
  exitoBanner: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  exitoText: {
    color: '#166534',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  exitoCerrar: {
    color: '#166534',
    fontSize: 15,
    fontWeight: '800',
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
  instruccion: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  items: {
    gap: 8,
  },
  itemBloque: {
    gap: 6,
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
  itemAcciones: {
    flexDirection: 'row',
    gap: 8,
  },
  btnAccion: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  btnAccionReingresar: {
    borderColor: '#16A34A',
    backgroundColor: '#F0FDF4',
  },
  btnAccionText: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
  },
  btnAccionTextReingresar: {
    color: '#166534',
  },
  btnAccionDescartar: {
    borderColor: '#DC2626',
    backgroundColor: '#FEF2F2',
  },
  btnAccionTextDescartar: {
    color: '#991B1B',
  },
  accionesOrden: {
    gap: 8,
  },
  btnConfirmar: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDeshabilitado: {
    opacity: 0.6,
  },
  btnConfirmarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
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
