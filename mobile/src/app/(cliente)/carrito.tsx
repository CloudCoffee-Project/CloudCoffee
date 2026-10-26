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
// Diseño: identidad visual del rol cliente (fondo crema, azul de acción,
// acentos amarillos y bordes cálidos) replicada del mockup web, incluidos los
// grupos por cafetería, el estado vacío y el resumen. Todos los colores y
// medidas salen de src/theme/tokens.ts (INT4-107).

import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCarrito } from '../../context/CarritoContext';
import { tokens } from '../../theme/tokens';

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
                      // Lo que todavía queda fuera del carrito. No es stock
                      // reservado: es el total menos lo que el usuario ya se
                      // llevó, para que se vea que la oferta es finita.
                      const disponibles = Math.max(linea.stock - linea.cantidad, 0);

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
                            <Text
                              style={styles.itemStock}
                              testID={`carrito-item-stock-${linea.ofertaId}`}
                            >
                              {disponibles > 0
                                ? `Quedan ${disponibles} disponibles`
                                : 'Sin stock restante'}
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
    backgroundColor: tokens.colores.fondo,
  },
  scrollContent: {
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingBottom: tokens.espaciado['3xl'],
    gap: tokens.espaciado.xxxl,
  },
  botonVolver: {
    alignSelf: 'flex-start',
    paddingHorizontal: tokens.espaciado.xs,
    paddingVertical: tokens.espaciado.xs,
  },
  botonVolverTexto: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.negrita,
  },

  // Encabezado
  header: {
    gap: tokens.espaciado.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: tokens.colores.amarilloFondo,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.amarilloBorde,
    borderRadius: tokens.radios.grande,
    paddingHorizontal: tokens.espaciado.lg,
    paddingVertical: tokens.espaciado.xs,
    color: tokens.colores.amarilloTexto,
    fontSize: tokens.tipografia.tamano.etiqueta,
    fontWeight: tokens.tipografia.peso.extranegrita,
    letterSpacing: tokens.tipografia.tracking.amplio,
  },
  titulo: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.titulo,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  origen: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
  },

  // Estado vacío
  vacio: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderStyle: 'dashed',
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    paddingVertical: tokens.espaciado['6xl'],
    paddingHorizontal: tokens.espaciado['2xl'],
    alignItems: 'center',
    gap: tokens.espaciado.lg,
  },
  vacioIcono: {
    fontSize: tokens.tipografia.tamano.iconoMedio,
  },
  vacioTitulo: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.destacado,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  vacioTexto: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
    lineHeight: tokens.tipografia.interlineado.normal,
    textAlign: 'center',
  },
  btnExplorar: {
    marginTop: tokens.espaciado.xxs,
    backgroundColor: tokens.colores.azul,
    borderRadius: tokens.radios.lg,
    paddingVertical: tokens.espaciado.lg,
    paddingHorizontal: tokens.espaciado.xxxl,
  },
  btnExplorarTexto: {
    color: tokens.colores.superficie,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.negrita,
  },

  // Grupos por cafetería
  grupos: {
    gap: tokens.espaciado.xxl,
  },
  grupoCard: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    padding: tokens.espaciado.xxl,
    gap: tokens.espaciado.xl,
    ...tokens.sombras.sutil,
  },
  grupoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.lg,
    borderBottomWidth: tokens.grosores.fino,
    borderBottomColor: tokens.colores.bordeCalido,
    paddingBottom: tokens.espaciado.md,
  },
  grupoTitulo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.sm,
    flex: 1,
  },
  grupoPin: {
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
  },
  grupoNombre: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.extranegrita,
    flex: 1,
  },
  grupoBadge: {
    color: tokens.colores.azulFuerte,
    backgroundColor: tokens.colores.infoSuave,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.infoChip,
    borderRadius: tokens.radios.md,
    paddingHorizontal: tokens.espaciado.md,
    paddingVertical: tokens.espaciado.xxs,
    fontSize: tokens.tipografia.tamano.pie,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  itemsLista: {
    gap: tokens.espaciado.lg,
  },
  itemCard: {
    backgroundColor: tokens.colores.fondo,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xl,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.xl,
    gap: tokens.espaciado.md,
  },
  itemInfo: {
    gap: tokens.espaciado.xxs,
  },
  itemNombre: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  itemPrecioUnitario: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.etiqueta,
  },
  itemStock: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.etiqueta,
    marginTop: tokens.espaciado.xxs,
  },
  itemControles: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.lg,
    // Separador interno de la tarjeta. Sólido y no punteado como en el mockup:
    // React Native no tiene borde punteado por lado, y en las otras pantallas el
    // separador interno también es sólido.
    borderTopWidth: tokens.grosores.fino,
    borderTopColor: tokens.colores.bordeCalido,
    paddingTop: tokens.espaciado.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.sm,
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.md,
    paddingHorizontal: tokens.espaciado.sm,
    paddingVertical: tokens.espaciado.xxs,
  },
  stepperBoton: {
    width: tokens.tamanos.botonStepper,
    height: tokens.tamanos.botonStepper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBotonApagado: {
    opacity: tokens.estados.apagado,
  },
  stepperBotonTexto: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  stepperValor: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.negrita,
    // Ancho mínimo para que la cifra no baile al cambiar de cantidad (layout).
    minWidth: tokens.espaciado['18'],
    textAlign: 'center',
  },
  itemSubtotal: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.extranegrita,
    flex: 1,
    textAlign: 'right',
  },
  btnQuitar: {
    paddingHorizontal: tokens.espaciado.xxs,
  },
  btnQuitarTexto: {
    fontSize: tokens.tipografia.tamano.boton,
    opacity: tokens.estados.tenue,
  },
  grupoSubtotalFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.lg,
    borderTopWidth: tokens.grosores.fino,
    borderTopColor: tokens.colores.bordeCalido,
    paddingTop: tokens.espaciado.md,
  },
  grupoSubtotalTexto: {
    color: tokens.colores.textoGris,
    fontSize: tokens.tipografia.tamano.detalle,
    flex: 1,
  },
  grupoSubtotalValor: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },

  // Método de pago
  metodoPagoSeccion: {
    gap: tokens.espaciado.md,
  },
  metodoPagoTitulo: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  opcionPago: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.xl,
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xl,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.lg,
  },
  opcionPagoActiva: {
    borderColor: tokens.colores.azul,
    backgroundColor: tokens.colores.opcionActivaFondo,
  },
  opcionPagoIcono: {
    fontSize: tokens.tipografia.tamano.encabezado,
  },
  opcionPagoInfo: {
    flex: 1,
  },
  opcionPagoNombre: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  opcionPagoDetalle: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.etiqueta,
  },

  // Resumen y pago
  resumen: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    paddingHorizontal: tokens.espaciado.xxl,
    paddingTop: tokens.espaciado.xxl,
    paddingBottom: tokens.espaciado['18'],
    gap: tokens.espaciado.lg,
    ...tokens.sombras.sutil,
  },
  resumenDesglose: {
    gap: tokens.espaciado.xs,
    borderBottomWidth: tokens.grosores.fino,
    borderBottomColor: tokens.colores.bordeCalido,
    paddingBottom: tokens.espaciado.md,
  },
  resumenFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.lg,
  },
  resumenFilaTexto: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
    flex: 1,
  },
  resumenFilaTotal: {
    paddingTop: tokens.espaciado.xxs,
  },
  resumenTotalTexto: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.extranegrita,
    flex: 1,
  },
  resumenTotalValor: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.subtitulo,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  btnPagar: {
    marginTop: tokens.espaciado.xs,
    backgroundColor: tokens.colores.azul,
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado.xxl,
    alignItems: 'center',
  },
  btnPagarTexto: {
    color: tokens.colores.superficie,
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  btnPresionado: {
    opacity: tokens.estados.presionado,
  },
});
