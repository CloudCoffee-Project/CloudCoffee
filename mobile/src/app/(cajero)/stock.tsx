// src/app/(cajero)/stock.tsx
//
// Stock de la cafetería del cajero (INT4-100). Reemplaza el placeholder y
// sigue la pestaña "Stock" del mockup (cloudcoffee-react → Cajero_Main):
// encabezado con el rol, buscador "🔍 Buscar producto en stock...", chips de
// filtro y una tarjeta por producto con su precio y las unidades disponibles.
//
// Los datos salen del contrato real de personal:
//   GET /v1/catalog/cafeterias/{cafeteriaId}/ofertas
// (services/inventario.ts). El endpoint devuelve todas las ofertas de la
// cafetería, agotadas incluidas; no trae categoría ni el nombre de la
// cafetería, así que la pantalla no los inventa. El nombre se resuelve con
// GET /v1/catalog/campus (mejor esfuerzo) y, si no está, se usa "Cafetería".
//
// Tiempo real (INT4-46): useCafeteriaStock escucha el topic
// /topic/cafeteria/{cafeteriaId}/stock y entrega { ofertaId: stockActual }.
// Ese valor se superpone sobre la lista cargada, sin volver a pedir el
// inventario. Una oferta se considera agotada si el backend la marcó
// OUT_OF_STOCK o si las unidades llegan a 0 (esOfertaAgotada).

import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Esqueleto, EsqueletoPulso } from '../../components/Esqueleto';
import { useAuth } from '../../context/AuthContext';
import { useCafeteriaStock } from '../../hooks/useCafeteriaStock';
import { toApiError } from '../../services/httpClient';
import { listarInventarioCafeteria, obtenerNombreCafeteria } from '../../services/inventario';
import { esOfertaAgotada } from '../../types/domain';
import type { InventarioItem } from '../../types/domain';
import { tokens } from '../../theme/tokens';

function formatearMonto(monto: number): string {
  return `$${monto.toLocaleString('es-CL')}`;
}

interface PropsCabecera {
  cafeteriaNombre: string;
}

function CabeceraStock({ cafeteriaNombre }: PropsCabecera) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <Text style={styles.rolePill}>POS Cajero</Text>
          <Text style={styles.headerTitulo}>Stock · {cafeteriaNombre}</Text>
        </View>
        <View style={styles.livePill} testID="cajero-stock-en-vivo">
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>En vivo</Text>
        </View>
      </View>
      <Text style={styles.ayuda}>
        Consulta las unidades disponibles de tu cafetería. El stock se actualiza en vivo.
      </Text>
    </>
  );
}

function FilaStock({ item }: { item: InventarioItem }) {
  const agotado = esOfertaAgotada(item);

  return (
    <View style={styles.card} testID={`cajero-stock-item-${item.ofertaId}`}>
      <View style={styles.cardInfo}>
        <Text style={styles.cardNombre}>{item.productoNombre}</Text>
        <Text style={styles.cardPrecio}>Precio: {formatearMonto(item.precio)}</Text>
      </View>
      <View style={[styles.stockBadge, agotado && styles.stockBadgeAgotado]}>
        <Text
          style={[styles.stockBadgeTexto, agotado && styles.stockBadgeTextoAgotado]}
          testID={`cajero-stock-badge-${item.ofertaId}`}
        >
          {item.stock} un.
        </Text>
      </View>
    </View>
  );
}

interface PropsChipFiltro {
  activo: boolean;
  etiqueta: string;
  onPress: () => void;
  testID: string;
}

function ChipFiltro({ activo, etiqueta, onPress, testID }: PropsChipFiltro) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, activo && styles.chipActivo]}
      hitSlop={6}
      testID={testID}
    >
      <Text style={[styles.chipText, activo && styles.chipTextActivo]}>{etiqueta}</Text>
    </Pressable>
  );
}

type FiltroStock = 'todos' | 'disponibles' | 'agotados';

function cumpleFiltro(item: InventarioItem, filtro: FiltroStock): boolean {
  switch (filtro) {
    case 'todos':
      return true;
    case 'disponibles':
      return !esOfertaAgotada(item);
    case 'agotados':
      return esOfertaAgotada(item);
  }
}

// Superpone el stock que llega por WebSocket sobre la lista del inventario.
// Si el evento trae unidades > 0, la oferta vuelve a estar disponible: el
// estado base puede haber quedado viejo respecto del stock en vivo.
function aplicarStockEnVivo(
  inventario: InventarioItem[],
  stockPorOferta: Record<string, number>
): InventarioItem[] {
  return inventario.map((item) => {
    const stockVivo = stockPorOferta[item.ofertaId];
    if (stockVivo === undefined) {
      return item;
    }
    return {
      ...item,
      stock: stockVivo,
      estado: stockVivo <= 0 ? 'OUT_OF_STOCK' : 'AVAILABLE',
    };
  });
}

export default function StockScreen() {
  const { sesion } = useAuth();
  const cafeteriaId = sesion?.cafeteriaId ?? null;

  const [inventario, setInventario] = useState<InventarioItem[]>([]);
  const [cafeteriaNombre, setCafeteriaNombre] = useState('Cafetería');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroStock>('todos');
  const [busqueda, setBusqueda] = useState('');

  // Stock en vivo de la cafetería: { ofertaId: stockActual }.
  const stockEnVivo = useCafeteriaStock(cafeteriaId ?? '');

  const cargar = useCallback(async (): Promise<void> => {
    if (!cafeteriaId) {
      setCargando(false);
      return;
    }

    try {
      const [items, nombre] = await Promise.all([
        listarInventarioCafeteria(cafeteriaId),
        obtenerNombreCafeteria(cafeteriaId),
      ]);
      setInventario(items);
      if (nombre) {
        setCafeteriaNombre(nombre);
      }
      setError(null);
    } catch (errorApi) {
      setError(toApiError(errorApi as never).message);
    } finally {
      setCargando(false);
    }
  }, [cafeteriaId]);

  // Se recarga al ganar foco: refleja el stock que cambió mientras el cajero
  // estaba en otra pestaña; el WebSocket cubre los cambios con la pantalla
  // abierta.
  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar])
  );

  const recargar = useCallback(async (): Promise<void> => {
    setCargando(true);
    await cargar();
  }, [cargar]);

  const itemsConStock = useMemo(
    () => aplicarStockEnVivo(inventario, stockEnVivo),
    [inventario, stockEnVivo]
  );

  const agotadosCount = useMemo(
    () => itemsConStock.filter(esOfertaAgotada).length,
    [itemsConStock]
  );
  const disponiblesCount = itemsConStock.length - agotadosCount;

  const itemsFiltrados = useMemo<InventarioItem[]>(() => {
    const query = busqueda.trim().toLowerCase();
    return itemsConStock.filter((item) => {
      const cumpleBusqueda = !query || item.productoNombre.toLowerCase().includes(query);
      return cumpleFiltro(item, filtro) && cumpleBusqueda;
    });
  }, [itemsConStock, filtro, busqueda]);

  const mensajeVacio =
    itemsConStock.length === 0
      ? 'No hay productos registrados en el stock de esta cafetería.'
      : 'No se encontraron productos que coincidan con la búsqueda.';

  if (!cafeteriaId) {
    return (
      <View style={styles.centrado} testID="cajero-stock-sin-cafeteria">
        <Text style={styles.emptyText}>
          Tu cuenta no tiene una cafetería asignada, así que no hay stock para mostrar.
        </Text>
      </View>
    );
  }

  if (cargando && inventario.length === 0) {
    return (
      <View style={styles.contenedor}>
        <CabeceraStock cafeteriaNombre={cafeteriaNombre} />
        <EsqueletoPulso testID="cajero-stock-esqueleto" style={styles.listaContenido}>
          {[0, 1, 2, 3, 4].map((indice) => (
            <View key={indice} style={styles.card}>
              <View style={styles.cardInfo}>
                <Esqueleto ancho="65%" alto={14} fuerte />
                <Esqueleto ancho="35%" alto={11} />
              </View>
              <Esqueleto ancho={58} alto={26} radio={tokens.radios.sm} />
            </View>
          ))}
        </EsqueletoPulso>
      </View>
    );
  }

  return (
    <View style={styles.contenedor}>
      <CabeceraStock cafeteriaNombre={cafeteriaNombre} />

      <View style={styles.searchWrapper}>
        <TextInput
          style={styles.searchInput}
          placeholder="🔍 Buscar producto en stock..."
          placeholderTextColor={tokens.colores.textoClaro}
          value={busqueda}
          onChangeText={setBusqueda}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          testID="cajero-stock-buscador"
        />
        {busqueda.length > 0 && (
          <Pressable
            onPress={() => setBusqueda('')}
            style={styles.clearButton}
            hitSlop={6}
            testID="cajero-stock-limpiar"
          >
            <Text style={styles.clearButtonText}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
        <View style={styles.chips}>
          <ChipFiltro
            activo={filtro === 'todos'}
            etiqueta={`Todos (${itemsConStock.length})`}
            onPress={() => setFiltro('todos')}
            testID="cajero-stock-chip-todos"
          />
          <ChipFiltro
            activo={filtro === 'disponibles'}
            etiqueta={`Disponibles (${disponiblesCount})`}
            onPress={() => setFiltro('disponibles')}
            testID="cajero-stock-chip-disponibles"
          />
          <ChipFiltro
            activo={filtro === 'agotados'}
            etiqueta={`Agotados (${agotadosCount})`}
            onPress={() => setFiltro('agotados')}
            testID="cajero-stock-chip-agotados"
          />
        </View>
      </ScrollView>

      {error && (
        <View style={styles.errorBanner} testID="cajero-stock-error">
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void recargar()} testID="cajero-stock-reintentar">
            <Text style={styles.errorBotonTexto}>Reintentar</Text>
          </Pressable>
        </View>
      )}

      <FlatList
        data={itemsFiltrados}
        keyExtractor={(item) => item.ofertaId}
        renderItem={({ item }) => <FilaStock item={item} />}
        contentContainerStyle={styles.listaContenido}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={cargando}
            onRefresh={() => void recargar()}
            tintColor={tokens.colores.azul}
          />
        }
        ListEmptyComponent={
          error ? null : (
            <View style={styles.emptyState} testID="cajero-stock-vacio">
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
    backgroundColor: tokens.colores.fondo,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingTop: tokens.espaciado.xl,
  },
  centrado: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tokens.colores.fondo,
    paddingHorizontal: tokens.espaciado['3xl'],
  },
  header: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingVertical: tokens.espaciado.xl,
    marginBottom: tokens.espaciado.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.md,
    ...tokens.sombras.sutil,
  },
  headerInfo: {
    flex: 1,
    gap: tokens.espaciado.xs,
  },
  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: tokens.colores.amarilloSuave,
    color: tokens.colores.amarilloTextoOscuro,
    fontSize: tokens.tipografia.tamano.pie,
    fontWeight: tokens.tipografia.peso.extranegrita,
    textTransform: 'uppercase',
    paddingHorizontal: tokens.espaciado.md,
    paddingVertical: tokens.espaciado.xs - 1,
    borderRadius: tokens.radios.xs,
    overflow: 'hidden',
  },
  headerTitulo: {
    color: tokens.colores.azul,
    fontSize: 17,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.sm - 1,
    backgroundColor: tokens.colores.exitoFondo,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.exitoBorde,
    borderRadius: tokens.radios.pildora,
    paddingHorizontal: tokens.espaciado.md,
    paddingVertical: tokens.espaciado.xs,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: tokens.radios.pildora,
    backgroundColor: tokens.colores.disponible,
  },
  liveText: {
    color: tokens.colores.exitoTexto,
    fontSize: tokens.tipografia.tamano.pie,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  ayuda: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
    lineHeight: tokens.tipografia.interlineado.normal,
    marginBottom: tokens.espaciado.xl,
  },
  searchWrapper: {
    marginBottom: tokens.espaciado.lg,
    justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.lg,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingVertical: tokens.espaciado.lg,
    paddingRight: tokens.espaciado['5xl'] + 4,
    fontSize: tokens.tipografia.tamano.cuerpo,
    color: tokens.colores.tintaCliente,
  },
  clearButton: {
    position: 'absolute',
    right: tokens.espaciado.xl,
  },
  clearButtonText: {
    color: tokens.colores.textoClaro,
    fontSize: 15,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  chipsScroll: {
    flexGrow: 0,
    marginBottom: tokens.espaciado.xl,
  },
  chips: {
    flexDirection: 'row',
  },
  chip: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.pildora,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.sm,
    marginRight: tokens.espaciado.md,
  },
  chipActivo: {
    backgroundColor: tokens.colores.azul,
    borderColor: tokens.colores.azul,
  },
  chipText: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  chipTextActivo: {
    color: tokens.colores.superficie,
  },
  errorBanner: {
    backgroundColor: tokens.colores.errorFondo,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.errorBorde,
    borderRadius: tokens.radios.lg,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.lg,
    marginBottom: tokens.espaciado.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.md,
  },
  errorText: {
    flex: 1,
    color: tokens.colores.errorTexto,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.semibold,
  },
  errorBotonTexto: {
    color: tokens.colores.errorTexto,
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.extranegrita,
    textDecorationLine: 'underline',
  },
  listaContenido: {
    paddingBottom: tokens.espaciado['3xl'],
    gap: tokens.espaciado.xl,
  },
  card: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxl,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingVertical: tokens.espaciado.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.xl,
    ...tokens.sombras.sutil,
  },
  cardInfo: {
    flex: 1,
    gap: tokens.espaciado.xs,
  },
  cardNombre: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  cardPrecio: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.medio,
  },
  stockBadge: {
    minWidth: 56,
    alignItems: 'center',
    backgroundColor: tokens.colores.infoSuave,
    borderRadius: tokens.radios.sm,
    paddingHorizontal: tokens.espaciado.md,
    paddingVertical: tokens.espaciado.xs + 1,
  },
  stockBadgeAgotado: {
    backgroundColor: tokens.colores.errorFondo,
  },
  stockBadgeTexto: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.detalle + 1,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  stockBadgeTextoAgotado: {
    color: tokens.colores.errorTexto,
  },
  emptyState: {
    paddingVertical: tokens.espaciado['6xl'],
    alignItems: 'center',
    paddingHorizontal: tokens.espaciado['3xl'],
  },
  emptyText: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.cuerpo,
    lineHeight: tokens.tipografia.interlineado.holgado,
    textAlign: 'center',
  },
});
