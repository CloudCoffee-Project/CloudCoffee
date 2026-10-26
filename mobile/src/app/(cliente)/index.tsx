// src/app/(cliente)/index.tsx
//
// Catálogo del cliente (INT4-28 categorías y productos, INT4-29 búsqueda,
// INT4-31 comparación de precios).
// Lista los productos de la sede activa: las pills de categoría filtran, la
// barra de búsqueda toleran errores de tipeo sobre esos mismos datos, y las
// cafeterías de cada producto salen de menor a mayor precio.
//
// Los datos salen de services/catalog.ts, contra el gateway: categorías
// GET /v1/catalog/categorias y productos GET /v1/catalog/productos del campus
// seleccionado. INT4-25 conectó esta pantalla al catalog-service: antes leía el
// snapshot local de src/datos-locales a través de services/catalogoLocal.ts,
// que tiene las mismas firmas, así que el swap fue cambiar el import.
//
// Si el gateway responde con problem+json (o sin sesión, que estas rutas
// exigen), la pantalla muestra el error normalizado con botón de reintento —
// nunca una lista hardcodeada.
//
// Los tipos vienen de src/types/domain.ts. El precio y el stock se leen de las
// Ofertas del producto: Producto no tiene precio propio. Se listan todas, una
// por cafetería del campus, porque el modelo es Campus 1:N Cafeteria y cada
// punto de retiro cobra su propio precio. Tocar la tarjeta abre el detalle
// (INT4-30), donde se elige en cuál retirar y cuántas unidades.
//
// INT4-31: las ofertas de cada tarjeta se ordenan de menor a mayor precio con el
// mismo criterio que el detalle, para que comparar no cambie de significado
// según la pantalla.
//
// Diseño: identidad visual del rol cliente (fondo crema, azul de acción,
// acentos amarillos y bordes cálidos) replicada del mockup web. Todos los
// colores y medidas salen de src/theme/tokens.ts (INT4-107).

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

// De donde vienen los datos: del gateway, a traves de services/catalog.ts. La
// pantalla no sabe si al otro lado hay un backend o un snapshot: pide las mismas
// funciones que pedia antes del swap (INT4-25).
import {
  leerCampusSeleccionado,
  listarCategorias,
  listarProductos,
  ordenarOfertasPorPrecio,
} from '../../services/catalog';
import { ApiProblem, toApiError } from '../../services/httpClient';
import { useCarrito } from '../../context/CarritoContext';
import { tokens } from '../../theme/tokens';
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
//
// Se descuenta lo que el usuario ya tiene en el carrito para que el número sea
// el mismo que muestra el detalle del producto: el catálogo no reserva stock,
// así que si acá se mostrara el total, la misma oferta aparecería con dos
// números distintos según la pantalla.
function formatearDisponibilidad(oferta: Oferta, enCarrito: number): string {
  if (!oferta.disponible || oferta.stock <= 0) {
    return 'Agotado';
  }
  const restante = Math.max(oferta.stock - enCarrito, 0);
  if (restante === 0) {
    return `${oferta.stock} en tu carrito`;
  }
  return `${restante} disp.`;
}

export default function CatalogoProductosScreen() {
  const router = useRouter();
  const { cantidadDe } = useCarrito();
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

  // INT4-31: las cafeterías de cada tarjeta se ordenan de menor a mayor precio
  // con el mismo criterio que el detalle. Se resuelve una vez por cambio de
  // búsqueda, en vez de ordenar dentro de renderItem, que se volvería a ejecutar
  // en cada render de la lista (por ejemplo, al escribir en el buscador).
  const productosOrdenados = useMemo(() => {
    if (!productosVisibles) {
      return productosVisibles;
    }
    return productosVisibles.map((producto) => ({
      ...producto,
      offers: ordenarOfertasPorPrecio(producto.offers ?? []),
    }));
  }, [productosVisibles]);

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
        data={productosOrdenados}
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
          const ofertas = item.offers ?? [];

          return (
            <Pressable
              style={({ pressed }) => [styles.productCard, pressed && styles.btnPresionado]}
              onPress={() =>
                router.push({ pathname: '/(cliente)/producto/[id]', params: { id: item.id } })
              }
              testID={`catalogo-producto-${item.id}`}
            >
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
                {ofertas.length > 0 ? (
                  ofertas.map((oferta) => (
                    <View
                      key={oferta.ofertaId}
                      style={styles.offerRow}
                      testID={`catalogo-oferta-${oferta.ofertaId}`}
                    >
                      <View style={styles.offerInfo}>
                        <Text style={styles.offerCafeName}>{oferta.cafeteriaNombre}</Text>
                        <Text style={styles.offerPrecio}>{formatearPrecio(oferta.precio)}</Text>
                      </View>
                      <Text
                        style={[
                          styles.offerStock,
                          !oferta.disponible || oferta.stock - cantidadDe(oferta.ofertaId) <= 0
                            ? styles.offerStockAgotado
                            : styles.offerStockDisponible,
                        ]}
                      >
                        {formatearDisponibilidad(oferta, cantidadDe(oferta.ofertaId))}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.noOfertas} testID={`catalogo-sin-oferta-${item.id}`}>
                    Sin ofertas disponibles en este campus.
                  </Text>
                )}
              </View>
            </Pressable>
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
    backgroundColor: tokens.colores.fondo,
  },
  topBar: {
    margin: tokens.espaciado.xxxl,
    marginBottom: tokens.espaciado.lg,
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingVertical: tokens.espaciado.xl,
    ...tokens.sombras.sutil,
  },
  campusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.lg,
  },
  campusIconMini: {
    width: tokens.tamanos.chipIcono,
    height: tokens.tamanos.chipIcono,
    backgroundColor: tokens.colores.amarilloFondo,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.amarilloBorde,
    borderRadius: tokens.radios.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  campusIconText: {
    fontSize: tokens.tipografia.tamano.subtitulo,
  },
  campusTextInfo: {
    flex: 1,
  },
  campusLabel: {
    fontSize: tokens.tipografia.tamano.pie,
    fontWeight: tokens.tipografia.peso.negrita,
    color: tokens.colores.textoNeutro,
    letterSpacing: tokens.tipografia.tracking.amplio,
  },
  campusName: {
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.extranegrita,
    color: tokens.colores.azul,
  },
  campusLink: {
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.negrita,
    color: tokens.colores.azul,
    textDecorationLine: 'underline',
  },
  searchContainer: {
    marginHorizontal: tokens.espaciado.xxxl,
    marginBottom: tokens.espaciado.lg,
  },
  searchInput: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xl,
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingVertical: tokens.espaciado.xl,
    // Hueco del botón de limpiar la búsqueda (posición de layout, regla 3).
    paddingRight: tokens.espaciado['6xl'],
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    color: tokens.colores.tintaCliente,
  },
  clearButton: {
    position: 'absolute',
    right: tokens.espaciado.xxl,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  clearButtonText: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  categoriesContainer: {
    marginBottom: tokens.espaciado.lg,
  },
  chip: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.pildora,
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingVertical: tokens.espaciado.md,
    marginLeft: tokens.espaciado.xxxl,
  },
  chipActivo: {
    backgroundColor: tokens.colores.azul,
    borderColor: tokens.colores.azul,
  },
  chipText: {
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.semibold,
    color: tokens.colores.textoGris,
  },
  chipTextActivo: {
    color: tokens.colores.superficie,
  },
  lista: {
    flex: 1,
  },
  listaContent: {
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingBottom: tokens.espaciado['3xl'],
    gap: tokens.espaciado.xxl,
  },
  productCard: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxl,
    padding: tokens.espaciado.xxl,
    gap: tokens.espaciado.xl,
  },
  productHeader: {
    flexDirection: 'row',
    gap: tokens.espaciado.lg,
  },
  productIconContainer: {
    width: tokens.tamanos.chipIcono,
    height: tokens.tamanos.chipIcono,
    backgroundColor: tokens.colores.amarilloFondo,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.amarilloBorde,
    borderRadius: tokens.radios.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productIconText: {
    fontSize: tokens.tipografia.tamano.subtitulo,
  },
  productDetails: {
    flex: 1,
  },
  productTitle: {
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.negrita,
    color: tokens.colores.azul,
  },
  productDescription: {
    fontSize: tokens.tipografia.tamano.detalle,
    color: tokens.colores.textoGris,
    lineHeight: tokens.tipografia.interlineado.normal,
    marginTop: tokens.espaciado.xxs,
  },
  offerList: {
    borderTopWidth: tokens.grosores.fino,
    borderTopColor: tokens.colores.bordeCalido,
    paddingTop: tokens.espaciado.lg,
    gap: tokens.espaciado.md,
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: tokens.colores.fondo,
    borderRadius: tokens.radios.md,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.lg,
    gap: tokens.espaciado.lg,
  },
  offerInfo: {
    flex: 1,
  },
  offerCafeName: {
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.negrita,
    color: tokens.colores.tintaCliente,
  },
  offerPrecio: {
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.extranegrita,
    color: tokens.colores.azul,
    marginTop: tokens.espaciado.xxs,
  },
  offerStock: {
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  offerStockDisponible: {
    color: tokens.colores.disponible,
  },
  offerStockAgotado: {
    color: tokens.colores.agotado,
  },
  noOfertas: {
    fontSize: tokens.tipografia.tamano.detalle,
    color: tokens.colores.textoNeutro,
    textAlign: 'center',
  },
  centrado: {
    paddingVertical: tokens.espaciado['6xl'],
    alignItems: 'center',
  },
  tarjetaError: {
    marginHorizontal: tokens.espaciado.xxxl,
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    padding: tokens.espaciado['22'],
    alignItems: 'center',
    gap: tokens.espaciado.md,
  },
  errorIcono: {
    fontSize: tokens.tipografia.tamano.iconoMedio,
  },
  errorTitulo: {
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.extranegrita,
    color: tokens.colores.tintaCliente,
  },
  errorMensaje: {
    fontSize: tokens.tipografia.tamano.cuerpo,
    color: tokens.colores.textoNeutro,
    textAlign: 'center',
  },
  btnReintentar: {
    marginTop: tokens.espaciado.md,
    backgroundColor: tokens.colores.azul,
    paddingVertical: tokens.espaciado.xl,
    paddingHorizontal: tokens.espaciado['3xl'],
    borderRadius: tokens.radios.lg,
  },
  btnReintentarTexto: {
    color: tokens.colores.superficie,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  btnPresionado: {
    opacity: tokens.estados.presionado,
  },
  tarjetaVacio: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderStyle: 'dashed',
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxl,
    padding: tokens.espaciado['5xl'],
    alignItems: 'center',
    gap: tokens.espaciado.md,
  },
  vacioIcono: {
    fontSize: tokens.tipografia.tamano.iconoMedio,
  },
  vacioTitulo: {
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.extranegrita,
    color: tokens.colores.tintaCliente,
  },
  vacioTexto: {
    fontSize: tokens.tipografia.tamano.cuerpo,
    color: tokens.colores.textoNeutro,
    textAlign: 'center',
    lineHeight: tokens.tipografia.interlineado.holgado,
  },
});
