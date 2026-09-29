// src/app/(cliente)/carrito.tsx
//
// Carrito del cliente (INT4-33). Toma el estado que dejó INT4-32
// (context/CarritoContext) y lo muestra agrupado por cafetería: una tarjeta por
// punto de retiro, con sus líneas, su subtotal, y al final el resumen con el
// total general.
//
// El agrupamiento es por cafetería y no por producto porque la línea del carrito
// ya es una Oferta: el mismo café comprado en dos cafeterías son dos líneas y se
// retiran en dos puntos distintos. Por eso la cabecera.avisa cuántos puntos de
// entrega hay y por eso el total se desglosa por subtotales: es lo que va a
// mandar el backend cuando exista, que crea una orden por punto de retiro.
//
// Esta pantalla no hace HTTP: no hay endpoint del carrito todavía, y el estado
// vive en memoria. El precio y el stock de cada línea son los que tenía la
// oferta cuando se agregó; el backend los revalida al crear la orden.
//
// Lo que NO se toca: el flujo de pago (INT4-38/39) vive en services/pagos.ts y
// sigue siendo el de ese compañero. Acá solo se le da el lugar que le corresponde
// en la pantalla —método de pago, resumen y botón—. El botón ya no abre el
// checkout de Mercado Pago: navega a la pantalla de checkout (INT4-35), que
// registra la compra con POST /v1/compras y recién ahí abre Mercado Pago. El
// mock que antes vivía en este archivo (httpbin) se fue con esa pantalla.
//
// Diseño: identidad visual del rol cliente (fondo #FAF7F2, azul #0052CC,
// acentos amarillos y bordes cálidos) replicada del mockup web, incluidos los
// grupos por cafetería, el estado vacío y el resumen.

import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCarrito } from '../../context/CarritoContext';

function formatearPrecio(precio: number): string {
  return `$${precio.toLocaleString('es-CL')}`;
}

export default function CarritoScreen() {
  const { total, grupos, cambiarCantidad, quitar } = useCarrito();

  // Ir al checkout es todo lo que hace el botón: la compra se registra allá
  // (INT4-35), no acá. El estado de "procesando" también vive allá, porque acá no
  // hay nada asíncrono que esperar.
  const handlePagar = (): void => {
    router.push('/(cliente)/checkout');
  };

  // Una cafetería: se retira en ese punto. Varias: el pedido se coordina en
  // varios, que es lo que el backend va a tener que generar como órdenes.
  const origen =
    grupos.length > 1
      ? `📦 Retiro programado en ${grupos.length} puntos de entrega`
      : grupos.length === 1
        ? `📍 Retiro en: ${grupos[0].cafeteriaNombre}`
        : 'Carrito sin productos';

  return (
    <SafeAreaView style={styles.pantalla} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="carrito-scroll"
      >
        <Pressable
          style={({ pressed }) => [styles.botonVolver, pressed && styles.btnPresionado]}
          onPress={() => router.back()}
          testID="carrito-volver"
        >
          <Text style={styles.botonVolverTexto}>← Volver al menú</Text>
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.badge}>MI PEDIDO</Text>
          <Text style={styles.titulo}>Tu Carrito de Compras</Text>
          <Text style={styles.origen} testID="carrito-origen">
            {origen}
          </Text>
        </View>

        {grupos.length === 0 ? (
          <View style={styles.vacio} testID="carrito-vacio">
            <Text style={styles.vacioIcono}>🛒</Text>
            <Text style={styles.vacioTitulo}>Tu carrito está vacío</Text>
            <Text style={styles.vacioTexto}>
              Agrega cafés y snacks desde el catálogo para iniciar tu compra.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.btnExplorar, pressed && styles.btnPresionado]}
              onPress={() => router.push('/(cliente)')}
              testID="carrito-ir-catalogo"
            >
              <Text style={styles.btnExplorarTexto}>Explorar Catálogo</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.grupos}>
              {grupos.map((grupo) => (
                <View
                  key={grupo.cafeteriaId}
                  style={styles.grupoCard}
                  testID={`carrito-grupo-${grupo.cafeteriaId}`}
                >
                  <View style={styles.grupoHeader}>
                    <View style={styles.grupoTitulo}>
                      <Text style={styles.grupoPin}>📍</Text>
                      <Text style={styles.grupoNombre}>{grupo.cafeteriaNombre}</Text>
                    </View>
                    <Text
                      style={styles.grupoBadge}
                      testID={`carrito-grupo-badge-${grupo.cafeteriaId}`}
                    >
                      {grupo.unidades} productos
                    </Text>
                  </View>

                  <View style={styles.itemsLista}>
                    {grupo.items.map((linea) => {
                      // El stock es el de la oferta cuando se agregó. Llegar a él
                      // no es un error del usuario, así que el botón se apaga en
                      // vez de dejarle pedir una unidad de más.
                      const alTope = linea.cantidad >= linea.stock;

                      return (
                        <View
                          key={linea.ofertaId}
                          style={styles.itemCard}
                          testID={`carrito-item-${linea.ofertaId}`}
                        >
                          <View style={styles.itemInfo}>
                            <Text style={styles.itemNombre}>{linea.productoNombre}</Text>
                            <Text style={styles.itemPrecioUnitario}>
                              {formatearPrecio(linea.precioUnitario)} c/u
                            </Text>
                          </View>

                          <View style={styles.itemControles}>
                            <View style={styles.stepper}>
                              <Pressable
                                style={({ pressed }) => [
                                  styles.stepperBoton,
                                  pressed && styles.btnPresionado,
                                ]}
                                onPress={() => cambiarCantidad(linea.ofertaId, linea.cantidad - 1)}
                                testID={`carrito-item-menos-${linea.ofertaId}`}
                              >
                                <Text style={styles.stepperBotonTexto}>−</Text>
                              </Pressable>
                              <Text style={styles.stepperValor}>{linea.cantidad}</Text>
                              <Pressable
                                style={({ pressed }) => [
                                  styles.stepperBoton,
                                  alTope && styles.stepperBotonApagado,
                                  pressed && !alTope && styles.btnPresionado,
                                ]}
                                onPress={() => cambiarCantidad(linea.ofertaId, linea.cantidad + 1)}
                                disabled={alTope}
                                testID={`carrito-item-mas-${linea.ofertaId}`}
                              >
                                <Text style={styles.stepperBotonTexto}>+</Text>
                              </Pressable>
                            </View>

                            <Text
                              style={styles.itemSubtotal}
                              testID={`carrito-item-subtotal-${linea.ofertaId}`}
                            >
                              {formatearPrecio(linea.precioUnitario * linea.cantidad)}
                            </Text>

                            <Pressable
                              style={({ pressed }) => [
                                styles.btnQuitar,
                                pressed && styles.btnPresionado,
                              ]}
                              onPress={() => quitar(linea.ofertaId)}
                              testID={`carrito-item-quitar-${linea.ofertaId}`}
                            >
                              <Text style={styles.btnQuitarTexto}>🗑️</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>

                  <View style={styles.grupoSubtotalFila}>
                    <Text style={styles.grupoSubtotalTexto}>Subtotal {grupo.cafeteriaNombre}:</Text>
                    <Text
                      style={styles.grupoSubtotalValor}
                      testID={`carrito-grupo-subtotal-${grupo.cafeteriaId}`}
                    >
                      {formatearPrecio(grupo.subtotal)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Método de pago: por ahora Mercado Pago es la única opción, así que
                se muestra como elegida y no se deja cambiar. Elegir otro medio es
                INT4-36/37; el checkout de abajo es el de INT4-38/39. */}
            <View style={styles.metodoPagoSeccion} testID="carrito-metodo-pago">
              <Text style={styles.metodoPagoTitulo}>Método de Pago</Text>
              <View style={[styles.opcionPago, styles.opcionPagoActiva]}>
                <Text style={styles.opcionPagoIcono}>💙</Text>
                <View style={styles.opcionPagoInfo}>
                  <Text style={styles.opcionPagoNombre}>Mercado Pago</Text>
                  <Text style={styles.opcionPagoDetalle}>
                    Tarjetas de débito, crédito o saldo en cuenta
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.resumen} testID="carrito-resumen">
              <View style={styles.resumenDesglose}>
                {grupos.map((grupo) => (
                  <View
                    key={`sub-${grupo.cafeteriaId}`}
                    style={styles.resumenFila}
                    testID={`carrito-resumen-subtotal-${grupo.cafeteriaId}`}
                  >
                    <Text style={styles.resumenFilaTexto}>Subtotal ({grupo.cafeteriaNombre})</Text>
                    <Text style={styles.resumenFilaTexto}>{formatearPrecio(grupo.subtotal)}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.resumenFila, styles.resumenFilaTotal]}>
                <Text style={styles.resumenTotalTexto}>Total a Pagar</Text>
                <Text style={styles.resumenTotalValor} testID="carrito-resumen-total">
                  {formatearPrecio(total)}
                </Text>
              </View>

              <Pressable
                style={({ pressed }) => [styles.btnPagar, pressed && styles.btnPresionado]}
                onPress={handlePagar}
                testID="carrito-pagar"
              >
                <Text style={styles.btnPagarTexto}>
                  {`Pagar con Mercado Pago ${formatearPrecio(total)}`}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pantalla: {
    flex: 1,
    backgroundColor: '#FAF7F2',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 16,
  },
  botonVolver: {
    alignSelf: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  botonVolverTexto: {
    color: '#0052CC',
    fontSize: 14,
    fontWeight: '700',
  },

  // Encabezado
  header: {
    gap: 5,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    color: '#B28300',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  titulo: {
    color: '#0052CC',
    fontSize: 22,
    fontWeight: '800',
  },
  origen: {
    color: '#6B7280',
    fontSize: 12,
  },

  // Estado vacío
  vacio: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#EFE9DE',
    borderRadius: 18,
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 9,
  },
  vacioIcono: {
    fontSize: 30,
  },
  vacioTitulo: {
    color: '#1D2433',
    fontSize: 16,
    fontWeight: '800',
  },
  vacioTexto: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  btnExplorar: {
    marginTop: 2,
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  btnExplorarTexto: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Grupos por cafetería
  grupos: {
    gap: 14,
  },
  grupoCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  grupoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
    paddingBottom: 8,
  },
  grupoTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  grupoPin: {
    fontSize: 14,
  },
  grupoNombre: {
    color: '#0052CC',
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  grupoBadge: {
    color: '#1E40AF',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: '700',
  },
  itemsLista: {
    gap: 10,
  },
  itemCard: {
    backgroundColor: '#FAF7F2',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  itemInfo: {
    gap: 2,
  },
  itemNombre: {
    color: '#1D2433',
    fontSize: 14,
    fontWeight: '700',
  },
  itemPrecioUnitario: {
    color: '#6B7280',
    fontSize: 11,
  },
  itemControles: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    // Separador interno de la tarjeta. Sólido y no punteado como en el mockup:
    // React Native no tiene borde punteado por lado, y en las otras pantallas el
    // separador interno también es sólido.
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 7,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EFE9DE',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stepperBoton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBotonApagado: {
    opacity: 0.4,
  },
  stepperBotonTexto: {
    color: '#0052CC',
    fontSize: 15,
    fontWeight: '800',
  },
  stepperValor: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '700',
    minWidth: 18,
    textAlign: 'center',
  },
  itemSubtotal: {
    color: '#0052CC',
    fontSize: 14,
    fontWeight: '800',
    flex: 1,
    textAlign: 'right',
  },
  btnQuitar: {
    paddingHorizontal: 2,
  },
  btnQuitarTexto: {
    fontSize: 15,
    opacity: 0.65,
  },
  grupoSubtotalFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 8,
  },
  grupoSubtotalTexto: {
    color: '#4B5563',
    fontSize: 12,
    flex: 1,
  },
  grupoSubtotalValor: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '800',
  },

  // Método de pago
  metodoPagoSeccion: {
    gap: 8,
  },
  metodoPagoTitulo: {
    color: '#1D2433',
    fontSize: 14,
    fontWeight: '800',
  },
  opcionPago: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  opcionPagoActiva: {
    borderColor: '#0052CC',
    backgroundColor: '#F3F8FE',
  },
  opcionPagoIcono: {
    fontSize: 19,
  },
  opcionPagoInfo: {
    flex: 1,
  },
  opcionPagoNombre: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '700',
  },
  opcionPagoDetalle: {
    color: '#6B7280',
    fontSize: 11,
  },

  // Resumen y pago
  resumen: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  resumenDesglose: {
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
    paddingBottom: 8,
  },
  resumenFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  resumenFilaTexto: {
    color: '#6B7280',
    fontSize: 12,
    flex: 1,
  },
  resumenFilaTotal: {
    paddingTop: 2,
  },
  resumenTotalTexto: {
    color: '#1D2433',
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
  },
  resumenTotalValor: {
    color: '#0052CC',
    fontSize: 18,
    fontWeight: '800',
  },
  btnPagar: {
    marginTop: 4,
    backgroundColor: '#0052CC',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnPagarTexto: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  btnPresionado: {
    opacity: 0.85,
  },
});
