// src/app/(cliente)/checkout.tsx
//
// Pantalla de checkout (INT4-35): el paso entre el carrito y Mercado Pago. Es la
// última pantalla antes de que la app deje de hablar con el backend, así que acá
// se manda la compra de verdad: POST /v1/compras con las líneas del carrito.
//
// El flujo completo es:
//   carrito  ->  checkout (esta pantalla)  ->  Mercado Pago  ->  resultado-pago
//
// O sea: el carrito ya no abre el checkout de Mercado Pago. Antes lo hacía con un
// mock que saltaba directo al navegador sin registrar la compra; ahora el carrito
// navega hasta acá, esta pantalla registra la orden y recién después abre el
// checkout de Mercado Pago con el initPoint que devuelve el backend.
//
// Por qué una pantalla y no un botón en el carrito: es el último momento en que
// el usuario puede ver y confirmar qué está comprando y en qué puntos de retiro,
// antes de que exista una orden. El monto final lo fija el backend en el
// initPoint, no esta pantalla: el carrito solo muestra lo que había en memoria.
//
// El backend todavía no expone POST /v1/compras (el gateway no rutea /v1/compras
// y order-service es un stub sin controller ni tablas). La pantalla consume el
// contrato real y muestra el error normalizado (toApiError) con botón de
// reintentar, igual que Mis Compras: cuando el backend implemente su lado,
// funciona sin cambios acá. Ver docs/contratos-backend.md, fila 6.

import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';

import { useCarrito } from '../../context/CarritoContext';
import { ApiProblem, getAccessToken, toApiError } from '../../services/httpClient';
// ItemCarrito de pagos es el payload de POST /v1/compras (solo ofertaId y
// cantidad) y no la línea del carrito de types/domain, que trae además el nombre
// y el precio. Se importa con alias para que no se confundan los dos.
import {
  abrirCheckoutMercadoPago,
  crearCompra,
  parsearRetornoPago,
  type ItemCarrito as ItemCarritoPago,
} from '../../services/pagos';

function formatearPrecio(precio: number): string {
  return `$${precio.toLocaleString('es-CL')}`;
}

export default function CheckoutScreen() {
  const router = useRouter();
  const { items, total, unidades, grupos, vaciar } = useCarrito();

  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmar = useCallback(async (): Promise<void> => {
    setProcesando(true);
    setError(null);

    try {
      // Sin sesión no hay token que mandar. No se intenta la llamada: el
      // httpClient solo inyecta el Authorization cuando hay token, y un 401 sin
      // sesión que se pueda refrescar produce un error que no dice nada.
      const accessToken = getAccessToken();
      if (!accessToken) {
        setError('Tu sesión no está activa. Vuelve a iniciar sesión para pagar.');
        return;
      }

      // El payload es solo ofertaId y cantidad: el precio no viaja, lo recalcula
      // el backend contra el catálogo, que es la fuente de la verdad. Mandarlo
      // además sería sugerir que la app puede fijar el monto.
      const payload: ItemCarritoPago[] = items.map((linea) => ({
        ofertaId: linea.ofertaId,
        cantidad: linea.cantidad,
      }));

      const compra = await crearCompra(payload, accessToken);

      // La orden ya existe del lado del servidor, así que el carrito se vacía acá
      // y no cuando el pago vuelve: si no se vaciara, volver al carrito y pagar
      // de nuevo crearía una segunda orden por los mismos productos. Vaciar no
      // afirma que el pago se haya hecho —la confirmación llega por webhook— solo
      // que el carrito se convirtió en una orden.
      vaciar();

      // El backend revalida precio y stock, así que su monto es el que va a
      // cobrar Mercado Pago. Si difiere del carrito se avisa en la consola: es
      // información de diagnóstico, no algo para frenar el pago.
      if (compra.montoTotal !== total) {
        console.warn(
          `[Checkout] El backend cobró $${compra.montoTotal} y el carrito suman $${total}. ` +
            'Gana el backend: el initPoint ya tiene el monto definitivo.'
        );
      }

      // Sin initPoint no hay checkout que abrir. La compra queda en revisión (el
      // estado que devuelve el backend) y el usuario la ve en Mis Compras, así
      // que se lo llevamos a la pantalla de resultado como pendiente en vez de
      // dejarlo esperando un navegador que no se va a abrir.
      if (!compra.initPoint) {
        router.replace({
          pathname: '/resultado-pago',
          params: { estado: 'pendiente', compraId: compra.compraId, paymentId: '' },
        });
        return;
      }

      const resultado = await abrirCheckoutMercadoPago(compra.initPoint);

      if (resultado.tipo === 'cerrado_sin_confirmar') {
        // El usuario cerró el navegador antes de completar el pago. La orden ya
        // está creada (el carrito se vació al crearla), así que no hay nada que
        // re-confirmar acá: se lo llevamos al resultado como pendiente, que le
        // dice que la compra quedó registrada y que avisaremos cuando el estado
        // cambie. Volver atrás no debe devolver al checkout.
        console.warn('[Checkout] El usuario cerró el checkout sin confirmar');
        router.replace({
          pathname: '/resultado-pago',
          params: { estado: 'pendiente', compraId: compra.compraId, paymentId: '' },
        });
        return;
      }

      const retorno = parsearRetornoPago(resultado.url);

      // replace y no push: volver atrás desde el resultado no debe devolver al
      // checkout, que volvería a ofrecer pagar una orden ya creada.
      router.replace({
        pathname: '/resultado-pago',
        params: {
          estado: retorno.estado,
          // El deep link trae el id en external_reference, pero si el backend no
          // lo configuró así no viene: se usa el que devolvió crearCompra, que
          // siempre existe.
          compraId: retorno.compraId ?? compra.compraId,
          paymentId: retorno.paymentId ?? '',
        },
      });
    } catch (thrown) {
      const apiError = toApiError(thrown as AxiosError<ApiProblem>);
      console.error('[Checkout] No se pudo crear la compra:', apiError.message);
      setError(apiError.message);
    } finally {
      setProcesando(false);
    }
  }, [items, total, vaciar, router]);

  const reintentar = useCallback((): Promise<void> => confirmar(), [confirmar]);

  const volverAlCarrito = useCallback((): void => {
    router.back();
  }, [router]);

  let contenido: ReactNode;

  if (items.length === 0) {
    // El carrito se vació al crear la orden, o el usuario llegó directo por
    // URL. No hay nada que confirmar, así que se ofrece volver al catálogo en
    // vez de un botón de pagar que no podría hacer nada.
    contenido = (
      <View style={styles.tarjetaVacio} testID="checkout-vacio">
        <Text style={styles.vacioIcono}>🧾</Text>
        <Text style={styles.vacioTitulo}>No hay nada que confirmar</Text>
        <Text style={styles.vacioTexto}>
          Tu carrito está vacío. Agrega cafés y snacks desde el catálogo para iniciar una compra.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.btnPrimario, pressed && styles.btnPresionado]}
          onPress={() => router.replace('/(cliente)')}
          testID="checkout-ir-catalogo"
        >
          <Text style={styles.btnPrimarioTexto}>Explorar Catálogo</Text>
        </Pressable>
      </View>
    );
  } else {
    contenido = (
      <ScrollView
        contentContainerStyle={styles.contenido}
        showsVerticalScrollIndicator={false}
        testID="checkout-scroll"
      >
        <View style={styles.resumenCabecera} testID="checkout-resumen">
          <Text style={styles.resumenLabel}>
            {unidades} {unidades === 1 ? 'producto' : 'productos'} ·{' '}
            {grupos.length === 1 ? '1 punto de retiro' : `${grupos.length} puntos de retiro`}
          </Text>
          <Text style={styles.total} testID="checkout-total">
            {formatearPrecio(total)}
          </Text>
        </View>

        {grupos.map((grupo) => (
          <View
            key={grupo.cafeteriaId}
            style={styles.grupoCard}
            testID={`checkout-grupo-${grupo.cafeteriaId}`}
          >
            <View style={styles.grupoHeader}>
              <View style={styles.grupoTitulo}>
                <Text style={styles.grupoPin}>📍</Text>
                <Text style={styles.grupoNombre}>{grupo.cafeteriaNombre}</Text>
              </View>
              <Text style={styles.grupoBadge} testID={`checkout-grupo-badge-${grupo.cafeteriaId}`}>
                {grupo.unidades} {grupo.unidades === 1 ? 'producto' : 'productos'}
              </Text>
            </View>

            {grupo.items.map((linea) => (
              <View
                key={linea.ofertaId}
                style={styles.itemFila}
                testID={`checkout-item-${linea.ofertaId}`}
              >
                <Text style={styles.itemCantidad}>{linea.cantidad}×</Text>
                <Text style={styles.itemNombre} numberOfLines={1}>
                  {linea.productoNombre}
                </Text>
                <Text
                  style={styles.itemSubtotal}
                  testID={`checkout-item-subtotal-${linea.ofertaId}`}
                >
                  {formatearPrecio(linea.precioUnitario * linea.cantidad)}
                </Text>
              </View>
            ))}

            <View style={styles.grupoSubtotalFila}>
              <Text style={styles.grupoSubtotalTexto}>Subtotal</Text>
              <Text
                style={styles.grupoSubtotalValor}
                testID={`checkout-grupo-subtotal-${grupo.cafeteriaId}`}
              >
                {formatearPrecio(grupo.subtotal)}
              </Text>
            </View>
          </View>
        ))}

        {error !== null && (
          <View style={styles.tarjetaError} testID="checkout-error">
            <Text style={styles.errorTitulo}>No pudimos registrar tu compra</Text>
            <Text style={styles.errorMensaje}>{error}</Text>
            <Pressable
              style={({ pressed }) => [styles.btnReintentar, pressed && styles.btnPresionado]}
              onPress={reintentar}
              disabled={procesando}
              testID="checkout-reintentar"
            >
              <Text style={styles.btnReintentarTexto}>Reintentar</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.metodoPago} testID="checkout-metodo-pago">
          <Text style={styles.metodoPagoIcono}>💙</Text>
          <View style={styles.metodoPagoInfo}>
            <Text style={styles.metodoPagoNombre}>Mercado Pago</Text>
            <Text style={styles.metodoPagoDetalle}>
              Vas a pagar en el sitio de Mercado Pago, con tarjeta o saldo.
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.btnPrimario,
            styles.btnConfirmar,
            procesando && styles.btnDeshabilitado,
            pressed && !procesando && styles.btnPresionado,
          ]}
          onPress={confirmar}
          disabled={procesando}
          testID="checkout-confirmar"
        >
          {procesando ? (
            <ActivityIndicator color="#FFFFFF" testID="checkout-procesando" />
          ) : (
            <Text style={styles.btnPrimarioTexto} testID="checkout-confirmar-texto">
              {`Confirmar y pagar ${formatearPrecio(total)}`}
            </Text>
          )}
        </Pressable>

        <Text style={styles.nota}>
          Al confirmar se registra tu compra y después te llevamos a Mercado Pago. El pago se
          confirma cuando Mercado Pago nos avisa, no al volver a la app.
        </Text>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      <Pressable
        style={({ pressed }) => [styles.botonVolver, pressed && styles.btnPresionado]}
        onPress={volverAlCarrito}
        testID="checkout-volver"
      >
        <Text style={styles.botonVolverTexto}>← Volver al carrito</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.badge}>CHECKOUT</Text>
        <Text style={styles.titulo}>Confirma tu compra</Text>
        <Text style={styles.subtitulo}>
          Revisa qué estás comprando y en dónde lo retiras antes de pagar.
        </Text>
      </View>

      {contenido}
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  botonVolverTexto: {
    color: '#0052CC',
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
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
  subtitulo: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 17,
  },
  contenido: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 14,
  },

  // Resumen arriba: el número grande que el usuario viene a confirmar.
  resumenCabecera: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  resumenLabel: {
    color: '#6B7280',
    fontSize: 12,
  },
  total: {
    color: '#0052CC',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },

  grupoCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 14,
    gap: 10,
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
  itemFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemCantidad: {
    color: '#0052CC',
    fontSize: 13,
    fontWeight: '800',
    minWidth: 22,
  },
  itemNombre: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  itemSubtotal: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '800',
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
  },
  grupoSubtotalValor: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '800',
  },

  metodoPago: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F3F8FE',
    borderWidth: 1.5,
    borderColor: '#0052CC',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  metodoPagoIcono: {
    fontSize: 19,
  },
  metodoPagoInfo: {
    flex: 1,
    gap: 2,
  },
  metodoPagoNombre: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '700',
  },
  metodoPagoDetalle: {
    color: '#6B7280',
    fontSize: 11,
    lineHeight: 15,
  },

  // Error
  tarjetaError: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#F5C2C2',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  errorTitulo: {
    color: '#1D2433',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorMensaje: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  btnReintentar: {
    marginTop: 6,
    backgroundColor: '#0052CC',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 26,
    alignItems: 'center',
  },
  btnReintentarTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Botones
  btnPrimario: {
    backgroundColor: '#0052CC',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnPrimarioTexto: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  btnConfirmar: {
    marginTop: 2,
    paddingVertical: 15,
  },
  btnDeshabilitado: {
    opacity: 0.6,
  },
  btnPresionado: {
    opacity: 0.85,
  },
  nota: {
    color: '#9CA3AF',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },

  // Vacío
  tarjetaVacio: {
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
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
});
