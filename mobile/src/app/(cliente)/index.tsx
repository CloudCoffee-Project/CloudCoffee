// src/app/(cliente)/index.tsx
//
// Catálogo del cliente (INT4-28 categorías y productos, INT4-29 búsqueda).
// Lista los productos de la sede activa: las pills de categoría filtran y la
// barra de búsqueda toleran errores de tipeo sobre esos mismos datos.
//
// Los datos salen de services/catalog.ts: categorías (GET /v1/catalog/categorias)
// y productos (GET /v1/catalog/productos) del campus seleccionado. El backend
// todavía no implementa los controllers: la pantalla consume el contrato real y
// muestra el error normalizado (toApiError) con botón de reintento, sin
// fallback a datos hardcodeados.
//
// Los tipos vienen de src/types/domain.ts. El precio y el stock se leen de la
// Oferta del producto en la cafetería del campus (services/campus.ts resuelve
// esa relación): Producto no tiene precio propio.
//
// Diseño: identidad visual del rol cliente (fondo #FAF7F2, azul #0052CC,
// acentos amarillos y bordes cálidos) replicada del mockup web.

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';

import {
  cafeteriaIdDeCampusSeleccionado,
  leerCampusSeleccionado,
  listarCategorias,
  listarProductos,
  ofertaDeCafeteria,
} from '../../services/catalog';
import { ApiProblem, toApiError } from '../../services/httpClient';
import type { Campus, Categoria, Oferta, Producto } from '../../types/domain';

// Filtro de "todas las categorías". No es un id del catálogo: es el valor del
// estado local que significa "sin filtro", por eso vive acá y no en domain.ts.
const TODAS_CATEGORIAS = 'todos';

// Distancia de Levenshtein entre dos cadenas, para tolerar errores de tipeo en
// la búsqueda. Se usa sobre los datos reales que devuelve el servicio, nunca
// sobre una lista local.
const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

// Coincidencia tolerante: primero por substring y después palabra por palabra
// con distancia de Levenshtein acotada según el largo de la palabra buscada.
function coincideConBusqueda(producto: Producto, query: string): boolean {
  const nombre = producto.nombre.toLowerCase();
  const descripcion = producto.descripcion.toLowerCase();

  if (nombre.includes(query) || descripcion.includes(query)) {
    return true;
  }

  const palabrasQuery = query.split(' ');
  const palabrasTexto = `${nombre} ${descripcion}`.split(' ');

  return palabrasQuery.some((pQuery) =>
    palabrasTexto.some((pTexto) => {
      if (Math.abs(pQuery.length - pTexto.length) > 2) return false;
      const maxDist = pQuery.length > 4 ? 2 : 1;
      return levenshteinDistance(pQuery, pTexto) <= maxDist;
    })
  );
}

function formatearPrecio(precio: number): string {
  return `$${precio.toLocaleString('es-CL')}`;
}

// El ícono del mockup se elegía por nombre de categoría en español. Las
// categorías reales llegan con id opaco, así que se usa un ícono neutro en vez
// de inventar un mapeo que rompería con ids desconocidos.
function formatearDisponibilidad(oferta: Oferta): string {
  if (!oferta.disponible || oferta.stock <= 0) {
    return 'Agotado';
  }
  return `${oferta.stock} disp.`;
}

export default function CatalogoProductosScreen() {
  const router = useRouter();
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [productos, setProductos] = useState<Producto[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [campus, setCampus] = useState<Campus | null>(null);
  const [categoriaId, setCategoriaId] = useState<string>(TODAS_CATEGORIAS);
  const [busqueda, setBusqueda] = useState('');

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const campusSeleccionado = await leerCampusSeleccionado();
      setCampus(campusSeleccionado);

      const listaCategorias = await listarCategorias();
      setCategorias(listaCategorias);
      setErrorCarga(null);

      if (campusSeleccionado) {
        const listaProductos = await listarProductos(
          campusSeleccionado.id,
          categoriaId === TODAS_CATEGORIAS ? undefined : categoriaId
        );
        setProductos(listaProductos);
      } else {
        setProductos([]);
      }
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setCategorias(null);
      setProductos(null);
      setErrorCarga(apiError.message);
    }
  }, [categoriaId]);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar])
  );

  // La búsqueda es local sobre los datos ya traídos del servicio: no cambia la
  // petición, solo acota lo que se muestra.
  const productosVisibles = useMemo(() => {
    const query = busqueda.trim().toLowerCase();
    if (!productos || query.length === 0) {
      return productos;
    }
    return productos.filter((producto) => coincideConBusqueda(producto, query));
  }, [productos, busqueda]);

  // La cafetería activa se resuelve desde el campus elegido: primero la que
  // trae el propio catálogo y, si todavía no está, el mapeo provisional de
  // services/campus.ts. Las ofertas del producto se resuelven contra ella, así
  // que el precio que se muestra es el de esa cafetería y no el de otra sede.
  const cafeteriaActual = cafeteriaIdDeCampusSeleccionado(campus);

  let contenido;

  if (errorCarga !== null) {
    contenido = (
      <View style={styles.tarjetaError} testID="catalogo-error">
        <Text style={styles.errorIcono}>☕</Text>
        <Text style={styles.errorTitulo}>No pudimos cargar el catálogo</Text>
        <Text style={styles.errorMensaje}>{errorCarga}</Text>
        <Pressable
          style={({ pressed }) => [styles.btnReintentar, pressed && styles.btnPresionado]}
          onPress={() => void cargar()}
          testID="catalogo-reintentar"
        >
          <Text style={styles.btnReintentarTexto}>Reintentar</Text>
        </Pressable>
      </View>
    );
  } else if (productos === null) {
    contenido = (
      <View style={styles.centrado} testID="catalogo-cargando">
        <ActivityIndicator size="large" color="#0052CC" />
      </View>
    );
  } else {
    contenido = (
      <FlatList
        data={productosVisibles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listaContent}
        showsVerticalScrollIndicator={false}
        testID="catalogo-lista"
        ListEmptyComponent={
          <View style={styles.tarjetaVacio} testID="catalogo-vacio">
            <Text style={styles.vacioIcono}>🔍</Text>
            <Text style={styles.vacioTitulo}>Sin resultados</Text>
            <Text style={styles.vacioTexto}>
              {busqueda.trim().length > 0
                ? 'No encontramos productos que coincidan con tu búsqueda.'
                : 'No hay productos disponibles en esta categoría.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const oferta = ofertaDeCafeteria(item, cafeteriaActual);

          return (
            <View style={styles.productCard} testID={`catalogo-producto-${item.id}`}>
              <View style={styles.productHeader}>
                <View style={styles.productIconContainer}>
                  <Text style={styles.productIconText}>🍴</Text>
                </View>
                <View style={styles.productDetails}>
                  <Text style={styles.productTitle}>{item.nombre}</Text>
                  <Text style={styles.productDescription}>{item.descripcion}</Text>
                </View>
              </View>

              <View style={styles.offerList}>
                {oferta ? (
                  <View style={styles.offerRow} testID={`catalogo-oferta-${oferta.ofertaId}`}>
                    <View style={styles.offerInfo}>
                      <Text style={styles.offerCafeName}>{oferta.cafeteriaNombre}</Text>
                      <Text style={styles.offerPrecio}>{formatearPrecio(oferta.precio)}</Text>
                    </View>
                    <Text
                      style={[
                        styles.offerStock,
                        !oferta.disponible || oferta.stock <= 0
                          ? styles.offerStockAgotado
                          : styles.offerStockDisponible,
                      ]}
                    >
                      {formatearDisponibilidad(oferta)}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.noOfertas} testID={`catalogo-sin-oferta-${item.id}`}>
                    Sin ofertas disponibles en este campus.
                  </Text>
                )}
              </View>
            </View>
          );
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.pantalla} edges={['top']}>
      {/* Sede activa */}
      <View style={styles.topBar}>
        <View style={styles.campusBox}>
          <View style={styles.campusIconMini}>
            <Text style={styles.campusIconText}>📍</Text>
          </View>
          <View style={styles.campusTextInfo}>
            <Text style={styles.campusLabel}>CAMPUS ACTUAL</Text>
            <Text style={styles.campusName} numberOfLines={1}>
              {campus?.nombre ?? 'Sin campus seleccionado'}
            </Text>
            <Pressable
              style={({ pressed }) => pressed && styles.btnPresionado}
              onPress={() => router.push('/(cliente)/campus')}
              testID="catalogo-cambiar-campus"
            >
              <Text style={styles.campusLink}>Cambiar</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar café, sándwich, snacks..."
          placeholderTextColor="#6B7280"
          value={busqueda}
          onChangeText={setBusqueda}
          autoCorrect={false}
          testID="catalogo-buscar"
        />
        {busqueda.length > 0 && (
          <Pressable
            style={styles.clearButton}
            onPress={() => setBusqueda('')}
            testID="catalogo-limpiar-busqueda"
          >
            <Text style={styles.clearButtonText}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Filtro por categorías */}
      {categorias !== null && categorias.length > 0 && (
        <View style={styles.categoriesContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Pressable
              style={({ pressed }) => [
                styles.chip,
                categoriaId === TODAS_CATEGORIAS && styles.chipActivo,
                pressed && styles.btnPresionado,
              ]}
              onPress={() => setCategoriaId(TODAS_CATEGORIAS)}
              testID="catalogo-chip-todos"
            >
              <Text
                style={[styles.chipText, categoriaId === TODAS_CATEGORIAS && styles.chipTextActivo]}
              >
                TODOS
              </Text>
            </Pressable>

            {categorias.map((cat) => (
              <Pressable
                key={cat.id}
                style={({ pressed }) => [
                  styles.chip,
                  categoriaId === cat.id && styles.chipActivo,
                  pressed && styles.btnPresionado,
                ]}
                onPress={() => setCategoriaId(cat.id)}
                testID={`catalogo-chip-${cat.id}`}
              >
                <Text style={[styles.chipText, categoriaId === cat.id && styles.chipTextActivo]}>
                  {cat.nombre}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.lista}>{contenido}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  topBar: {
    margin: 16,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  campusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  campusIconMini: {
    width: 38,
    height: 38,
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  campusIconText: {
    fontSize: 17,
  },
  campusTextInfo: {
    flex: 1,
  },
  campusLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.3,
  },
  campusName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0052CC',
  },
  campusLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0052CC',
    textDecorationLine: 'underline',
  },
  searchContainer: {
    marginHorizontal: 16,
    marginBottom: 10,
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingRight: 40,
    fontSize: 14,
    color: '#1D2433',
  },
  clearButton: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  clearButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '700',
  },
  categoriesContainer: {
    marginBottom: 10,
  },
  chip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginLeft: 16,
  },
  chipActivo: {
    backgroundColor: '#0052CC',
    borderColor: '#0052CC',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  chipTextActivo: {
    color: '#FFFFFF',
  },
  lista: {
    flex: 1,
  },
  listaContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  productHeader: {
    flexDirection: 'row',
    gap: 10,
  },
  productIconContainer: {
    width: 38,
    height: 38,
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productIconText: {
    fontSize: 18,
  },
  productDetails: {
    flex: 1,
  },
  productTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0052CC',
  },
  productDescription: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 16,
    marginTop: 2,
  },
  offerList: {
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 10,
    gap: 8,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF7F2',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  offerInfo: {
    flex: 1,
  },
  offerCafeName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D2433',
  },
  offerPrecio: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0052CC',
    marginTop: 2,
  },
  offerStock: {
    fontSize: 12,
    fontWeight: '700',
  },
  offerStockDisponible: {
    color: '#15803D',
  },
  offerStockAgotado: {
    color: '#B42318',
  },
  noOfertas: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  centrado: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  tarjetaError: {
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  errorIcono: {
    fontSize: 30,
  },
  errorTitulo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  errorMensaje: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  btnReintentar: {
    marginTop: 8,
    backgroundColor: '#0052CC',
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 12,
  },
  btnReintentarTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnPresionado: {
    opacity: 0.85,
  },
  tarjetaVacio: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#EFE9DE',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  vacioIcono: {
    fontSize: 28,
  },
  vacioTitulo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  vacioTexto: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 19,
  },
});
