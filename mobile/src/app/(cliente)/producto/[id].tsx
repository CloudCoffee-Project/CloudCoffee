// src/app/(cliente)/producto/[id].tsx
//
// Detalle de un producto (INT4-30). Muestra un producto del campus activo con
// todas sus ofertas (una por cafetería de esa sede), deja elegir dónde retirar
// y con qué cantidad, y muestra el total real de esa oferta.
//
// INT4-31: las cafeterías se comparan por precio, así que la lista va siempre de
// menor a mayor, sin control de orden en pantalla.
//
// INT4-32: el botón de agregar ya no navega al carrito, lo que hace es sumar la
// oferta elegida al carrito global (context/CarritoContext).
// Al agregar se muestra un aviso con el producto y la cantidad que entraron, y se
// va solo a los dos segundos. El mockup no tiene nada de esto, pero el botón ya
// no salta de pantalla: sin una confirmación, no hay forma de saber que el
// traslado al carrito ocurrió. El carrito (INT4-33) sigue siendo donde el usuario
// revisa y cambia lo que compró.
//
// Los datos salen de services/catalog.ts:
//   - GET /v1/catalog/productos/{id}?campusId= → el producto con sus ofertas.
//   - GET /v1/catalog/categorias                 → para poner el nombre de la
//     categoría en la pastilla (Producto solo trae categoriaId).
// El backend todavía no implementa los controllers: la pantalla consume el
// contrato real y muestra el error normalizado (toApiError) con botón de
// reintento, sin fallback a datos hardcodeados.
//
// Los tipos vienen de src/types/domain.ts. El precio y el stock se leen de la
// Oferta elegida: Producto no tiene precio propio. La dirección que se muestra
// en cada oferta es la del campus (Cafeteria no tiene dirección propia en el
// modelo), y solo se ofrece una cafetería si su Oferta está disponible.
//
// Diseño: identidad visual del rol cliente (fondo #FAF7F2, azul #0052CC,
// acentos amarillos y bordes cálidos) replicada del mockup web.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';

import {
  leerCampusSeleccionado,
  listarCategorias,
  obtenerProducto,
  ordenarOfertasPorPrecio,
} from '../../../services/catalog';
import { ApiProblem, toApiError } from '../../../services/httpClient';
import { useCarrito } from '../../../context/CarritoContext';
import type { Campus, Categoria, Oferta, Producto } from '../../../types/domain';

function formatearPrecio(precio: number): string {
  return `$${precio.toLocaleString('es-CL')}`;
}

// Una oferta está agotada si el backend la marca como no disponible o si no
// queda stock. Tolera null porque antes de elegir cafetería no hay ninguna.
function estaAgotada(oferta: Oferta | null): boolean {
  return !oferta || !oferta.disponible || oferta.stock <= 0;
}

// Cuánto queda en pantalla el aviso de "agregado al carrito" antes de irse solo.
const AVISO_MS = 2000;

export default function DetalleProductoScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [campus, setCampus] = useState<Campus | null>(null);
  const [producto, setProducto] = useState<Producto | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ofertaElegida, setOfertaElegida] = useState<string | null>(null);
  const [cantidad, setCantidad] = useState(1);

  const { agregar: agregarItem } = useCarrito();

  // Confirmación de que el producto entró al carrito. Vive en la pantalla y no
  // en CarritoContext a propósito: el carrito global guarda lo que se compró,
  // esto solo avisa que la acción pasó. Se va solo con la animación, sin
  // setTimeout y sin que el usuario tenga que tocar nada.
  const [aviso, setAviso] = useState<string | null>(null);
  // El Animated.Value va en useState y no en un ref porque el render lo lee
  // para la opacidad, y el compilador de React no deja tocar un ref durante el
  // render. El inicializador perezoso lo crea una sola vez, igual que un ref.
  const [opacidadAviso] = useState(() => new Animated.Value(0));
  const animacionAviso = useRef<Animated.CompositeAnimation | null>(null);

  const mostrarAviso = useCallback(
    (texto: string) => {
      // Agregar dos veces seguidas reinicia la cuenta del aviso en vez de dejar
      // el anterior a medio camino.
      animacionAviso.current?.stop();
      setAviso(texto);
      opacidadAviso.setValue(0);
      animacionAviso.current = Animated.sequence([
        Animated.timing(opacidadAviso, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.delay(AVISO_MS),
        Animated.timing(opacidadAviso, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]);
      animacionAviso.current.start(({ finished }) => {
        // finished=false si el aviso se reinició o si la pantalla se cerró: en
        // ese caso corre su propia cuenta y este callback no debe borrarlo.
        if (finished) setAviso(null);
      });
    },
    [opacidadAviso]
  );

  // La animación se frena al desmontar: si no, el callback de cierre intentaría
  // setAviso sobre un componente que ya no existe.
  useEffect(
    () => () => {
      animacionAviso.current?.stop();
    },
    []
  );

  const cargar = useCallback(async (): Promise<void> => {
    if (!id) {
      setErrorCarga('No pudimos identificar el producto.');
      setCargando(false);
      return;
    }

    setCargando(true);
    // Cada carga arranca sin selección: si el producto cambió al navegar (o el
    // usuario vuelve desde el carrito), no se arrastra la cantidad ni la
    // cafetería que había quedado de la vista anterior.
    setOfertaElegida(null);
    setCantidad(1);
    try {
      const campusSeleccionado = await leerCampusSeleccionado();
      setCampus(campusSeleccionado);

      if (!campusSeleccionado) {
        setProducto(null);
        setErrorCarga(null);
        setCargando(false);
        return;
      }

      const [detalle, listaCategorias] = await Promise.all([
        obtenerProducto(id, campusSeleccionado.id),
        listarCategorias(),
      ]);

      setProducto(detalle);
      setCategorias(listaCategorias);
      setErrorCarga(null);
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setProducto(null);
      setErrorCarga(apiError.message);
    } finally {
      setCargando(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar])
  );

  // INT4-31: las cafeterías se comparan por precio, así que la lista va de menor
  // a mayor y las agotadas quedan en su lugar en la escalera, no al final. Se
  // ordena sobre una copia: `producto.offers` es la respuesta del servicio y no
  // debe reordenarse en el sitio.
  const ofertas = useMemo(() => ordenarOfertasPorPrecio(producto?.offers ?? []), [producto]);
  const disponibles = ofertas.filter((oferta) => !estaAgotada(oferta));
  const elegida = ofertas.find((oferta) => oferta.ofertaId === ofertaElegida) ?? null;

  // Oferta con la que se está trabajando: la elegida si sigue disponible, o la
  // más barata disponible mientras el usuario no elija. Así el stepper y el total
  // funcionan desde el inicio sobre la oferta que se ve destacada arriba.
  const activa = estaAgotada(elegida) ? (disponibles[0] ?? null) : elegida;

  const nombreCategoria = categorias.find((c) => c.id === producto?.categoriaId)?.nombre;

  function elegirOferta(oferta: Oferta): void {
    if (estaAgotada(oferta)) return;
    setOfertaElegida(oferta.ofertaId);
    setCantidad(1);
  }

  const total = activa ? activa.precio * cantidad : 0;

  const puedeSumar = Boolean(activa && cantidad < activa.stock);

  function cambiarCantidad(delta: number): void {
    if (!activa) return;
    const siguiente = cantidad + delta;
    if (siguiente < 1 || siguiente > activa.stock) return;
    setCantidad(siguiente);
  }

  let contenido;

  if (cargando) {
    contenido = (
      <View style={styles.centrado} testID="producto-detalle-cargando">
        <ActivityIndicator size="large" color="#0052CC" />
      </View>
    );
  } else if (errorCarga !== null) {
    contenido = (
      <View style={styles.tarjetaAviso} testID="producto-detalle-error">
        <Text style={styles.avisoIcono}>☕</Text>
        <Text style={styles.avisoTitulo}>No pudimos cargar el producto</Text>
        <Text style={styles.avisoTexto}>{errorCarga}</Text>
        <Pressable
          style={({ pressed }) => [styles.btnPrimario, pressed && styles.btnPresionado]}
          onPress={() => void cargar()}
          testID="producto-detalle-reintentar"
        >
          <Text style={styles.btnPrimarioTexto}>Reintentar</Text>
        </Pressable>
      </View>
    );
  } else if (!campus) {
    // Solo llega acá si no hubo error: el aviso de sede va después del error
    // para que una falla real no se disfraca de "todavía no elegiste campus".
    contenido = (
      <View style={styles.tarjetaAviso} testID="producto-detalle-sin-campus">
        <Text style={styles.avisoIcono}>📍</Text>
        <Text style={styles.avisoTitulo}>Elige tu sede primero</Text>
        <Text style={styles.avisoTexto}>
          Para ver el precio y el stock de este producto necesitamos saber en qué campus estás.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.btnPrimario, pressed && styles.btnPresionado]}
          onPress={() => router.push('/(cliente)/campus')}
          testID="producto-detalle-ir-campus"
        >
          <Text style={styles.btnPrimarioTexto}>Ir a seleccionar sede</Text>
        </Pressable>
      </View>
    );
  } else if (ofertas.length === 0) {
    contenido = (
      <View style={styles.tarjetaAviso} testID="producto-detalle-sin-ofertas">
        <Text style={styles.avisoIcono}>🍽️</Text>
        <Text style={styles.avisoTitulo}>Sin ofertas en este campus</Text>
        <Text style={styles.avisoTexto}>
          Este producto todavía no tiene precio ni stock disponible en {campus.nombre}.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.btnSecundario, pressed && styles.btnPresionado]}
          onPress={() => router.push('/(cliente)')}
          testID="producto-detalle-volver-catalogo"
        >
          <Text style={styles.btnSecundarioTexto}>Volver al catálogo</Text>
        </Pressable>
      </View>
    );
  } else {
    contenido = (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="producto-detalle-scroll"
      >
        <View style={styles.categoriaFila}>
          {nombreCategoria ? (
            <View style={styles.categoriaPill}>
              <Text style={styles.categoriaPillTexto}>{nombreCategoria}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.header}>
          <Text style={styles.titulo}>{producto?.nombre}</Text>
          <Text style={styles.descripcion}>{producto?.descripcion}</Text>
        </View>

        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>Selecciona la cafetería de retiro</Text>
          <View style={styles.ofertasLista}>
            {ofertas.map((oferta) => {
              const agotada = estaAgotada(oferta);
              const seleccionadaActual = activa?.ofertaId === oferta.ofertaId;

              return (
                <Pressable
                  key={oferta.ofertaId}
                  style={({ pressed }) => [
                    styles.ofertaCard,
                    seleccionadaActual && styles.ofertaCardActiva,
                    agotada && styles.ofertaCardAgotada,
                    pressed && !agotada && styles.btnPresionado,
                  ]}
                  onPress={() => elegirOferta(oferta)}
                  disabled={agotada}
                  testID={`producto-detalle-oferta-${oferta.ofertaId}`}
                >
                  <View style={styles.ofertaInfo}>
                    <Text style={styles.ofertaNombre}>{oferta.cafeteriaNombre}</Text>
                    {campus.direccion ? (
                      <Text style={styles.ofertaUbicacion}>📍 {campus.direccion}</Text>
                    ) : null}
                    <Text
                      style={[
                        styles.ofertaEstado,
                        agotada ? styles.ofertaEstadoAgotada : styles.ofertaEstadoDisponible,
                      ]}
                    >
                      {agotada ? '🔴 Agotado' : `🟢 En stock · ${oferta.stock} disp.`}
                    </Text>
                  </View>
                  <Text style={styles.ofertaPrecio}>{formatearPrecio(oferta.precio)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {activa ? (
          <View style={styles.cantidadWrapper} testID="producto-detalle-cantidad">
            <Text style={styles.cantidadLabel}>Cantidad:</Text>
            <View style={styles.stepper}>
              <Pressable
                style={({ pressed }) => [styles.stepperBoton, pressed && styles.btnPresionado]}
                onPress={() => cambiarCantidad(-1)}
                disabled={!activa || cantidad <= 1}
                testID="producto-detalle-menos"
              >
                <Text style={styles.stepperBotonTexto}>−</Text>
              </Pressable>
              <Text style={styles.stepperValor}>{cantidad}</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.stepperBoton,
                  !puedeSumar && styles.stepperBotonApagado,
                  pressed && styles.btnPresionado,
                ]}
                onPress={() => cambiarCantidad(1)}
                disabled={!puedeSumar}
                testID="producto-detalle-mas"
              >
                <Text style={styles.stepperBotonTexto}>+</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  const agregarAlCarrito = () => {
    if (!activa || !producto) return;
    agregarItem(
      {
        ofertaId: activa.ofertaId,
        productoId: producto.id,
        productoNombre: producto.nombre,
        precioUnitario: activa.precio,
        cafeteriaId: activa.cafeteriaId,
        cafeteriaNombre: activa.cafeteriaNombre,
        stock: activa.stock,
      },
      cantidad
    );
    mostrarAviso(`Agregado al carrito · ${cantidad} × ${producto.nombre}`);
  };

  const botonAgregarDisabled = !activa;

  return (
    <SafeAreaView style={styles.pantalla} edges={['top']}>
      <Pressable
        style={({ pressed }) => [styles.botonVolver, pressed && styles.btnPresionado]}
        onPress={() => router.back()}
        testID="producto-detalle-volver"
      >
        <Text style={styles.botonVolverTexto}>← Volver al menú</Text>
      </Pressable>

      <View style={styles.cuerpo}>{contenido}</View>

      {/* El aviso de "agregado al carrito" flota sobre el pie y no lo tapa: el
          botón queda al alcance para sumar otra unidad sin esperar a que se
          vaya. pointerEvents="none" para que nunca se coma un toque. */}
      {aviso !== null ? (
        <Animated.View
          style={[styles.avisoAgregado, { opacity: opacidadAviso }]}
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          testID="producto-detalle-aviso"
        >
          <Text style={styles.avisoAgregadoIcono}>✅</Text>
          <Text style={styles.avisoAgregadoTexto}>{aviso}</Text>
        </Animated.View>
      ) : null}

      {/* El pie acompaña al detalle: si el producto se cargó, el botón siempre
          está, deshabilitado y diciendo "Agotado" cuando no hay nada comprable. */}
      {!cargando && campus !== null && errorCarga === null && ofertas.length > 0 ? (
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.btnAgregar,
              botonAgregarDisabled && styles.btnAgregarDeshabilitado,
              pressed && !botonAgregarDisabled && styles.btnPresionado,
            ]}
            onPress={agregarAlCarrito}
            disabled={botonAgregarDisabled}
            testID="producto-detalle-agregar"
          >
            <Text style={styles.btnAgregarTexto}>
              {botonAgregarDisabled
                ? 'Agotado en este punto'
                : `Agregar ${cantidad} al carrito · ${formatearPrecio(total)}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  botonVolver: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  botonVolverTexto: {
    color: '#0052CC',
    fontSize: 14,
    fontWeight: '700',
  },
  cuerpo: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 16,
  },
  categoriaFila: {
    flexDirection: 'row',
  },
  categoriaPill: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  categoriaPillTexto: {
    color: '#92400E',
    fontSize: 11,
    fontWeight: '800',
  },
  header: {
    gap: 2,
  },
  titulo: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1D2433',
  },
  descripcion: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
  },
  seccion: {
    gap: 4,
  },
  seccionTitulo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  ofertasLista: {
    gap: 8,
    marginTop: 6,
  },
  ofertaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
  },
  ofertaCardActiva: {
    borderColor: '#0052CC',
    backgroundColor: '#F0F7FF',
  },
  ofertaCardAgotada: {
    opacity: 0.5,
  },
  ofertaInfo: {
    flex: 1,
    gap: 2,
  },
  ofertaNombre: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D2433',
  },
  ofertaUbicacion: {
    fontSize: 12,
    color: '#6B7280',
  },
  ofertaEstado: {
    fontSize: 12,
    fontWeight: '700',
  },
  ofertaEstadoDisponible: {
    color: '#15803D',
  },
  ofertaEstadoAgotada: {
    color: '#B42318',
  },
  ofertaPrecio: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0052CC',
  },
  cantidadWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cantidadLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D2433',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepperBoton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EFE9DE',
    backgroundColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBotonApagado: {
    opacity: 0.4,
  },
  stepperBotonTexto: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1D2433',
  },
  stepperValor: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1D2433',
    minWidth: 20,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    backgroundColor: '#FAF7F2',
  },
  // Tinta oscura sobre el fondo crema, al revés que las tarjetas claras del
  // resto de la pantalla, para que se lea como algo flotando y no como parte
  // del contenido. elevation solo aplica en Android: es la sombra de Material.
  avisoAgregado: {
    position: 'absolute',
    left: 16,
    right: 16,
    // Por encima del pie, cuyo alto lo determinan styles.footer y
    // styles.btnAgregar. Si se toca uno de los dos, hay que ajustar este número.
    bottom: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1D2433',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    elevation: 3,
  },
  avisoAgregadoIcono: {
    fontSize: 15,
  },
  avisoAgregadoTexto: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  btnAgregar: {
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnAgregarDeshabilitado: {
    backgroundColor: '#9AA4B2',
  },
  btnAgregarTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnPresionado: {
    opacity: 0.85,
  },
  centrado: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  tarjetaAviso: {
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  avisoIcono: {
    fontSize: 30,
  },
  avisoTitulo: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1D2433',
  },
  avisoTexto: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 19,
  },
  btnPrimario: {
    marginTop: 8,
    backgroundColor: '#0052CC',
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 12,
  },
  btnPrimarioTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnSecundario: {
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: '#0052CC',
    paddingVertical: 11,
    paddingHorizontal: 26,
    borderRadius: 12,
  },
  btnSecundarioTexto: {
    color: '#0052CC',
    fontSize: 14,
    fontWeight: '700',
  },
});
