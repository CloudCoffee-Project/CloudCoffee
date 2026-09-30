// src/app/(cliente)/checkout.tsx
//
// Pantalla de checkout (finalización de pedido, INT4-35): recopila los datos de
// la transacción y envía la orden al backend con POST /v1/compras. Es UNA sola
// pantalla, en línea con el mockup (paso "Pago & Revisión"), que además dice si
// la compra llegó al backend o no.
//
// Estructura (según la especificación):
//   - Resumen del pedido: líneas del carrito agrupadas por punto de retiro,
//     desglose de precios (Subtotal / Despacho / Impuestos) y total a pagar.
//   - Datos de entrega y facturación: campos validados (nombre completo, correo,
//     teléfono y dirección física cuando el método es envío) + método de entrega
//     (retiro en cafetería, sin costo, por defecto; o envío estándar $4.990).
//   - Método de pago: Mercado Pago (pasarela integrada). La tarjeta se ingresa
//     en el sitio de Mercado Pago, no en la app (la app no maneja datos PCI).
//   - Botón principal "Confirmar y Pagar $X": al pulsarlo entra en estado de
//     carga (spinner + deshabilitado) para evitar dobles envíos o dobles cobros.
//
// Lógica y envío:
//   El botón valida primero los datos de entrega; si algo falta, muestra el
//   error debajo del campo sin llamar al backend. Con el formulario válido
//   dispara POST /v1/compras con { items, datosEntrega } y el accessToken.
//
// Estados de respuesta:
//   - 200/201: la compra quedó registrada → la misma pantalla muestra la
//     confirmación "¡Compra realizada!" con el número de orden. Si el backend
//     devuelve initPoint (pago pendiente), en este flujo se abre Mercado Pago
//     y el comprobante lo confirma resultado-pago al volver.
//   - 200/201 con estado "revisión requerida" (INT4-36): la compra quedó
//     registrada pero necesita revisión antes de confirmarse → la misma
//     pantalla muestra "Tu compra está en revisión" con el número de orden.
//     No está confirmada ni fallida: no se abre Mercado Pago, no se vuelve a
//     cobrar y no se ofrece reintentar el pago.
//   - 401/403: se muestra "Se requiere autenticación válida..." y el aviso
//     "Nada se cobró y tu carrito sigue listo", con "Volver a intentar" y
//     "Volver al carrito".
//   - 400/500: mensaje contextual del backend (rechazo, fondos insuficientes,
//     etc.) en la misma vista de fallo, con el carrito intacto.
//
// El backend todavía no expone POST /v1/compras (el gateway no rutea /v1/compras
// y order-service es un stub sin controller ni tablas): hoy el usuario ve la
// vista de fallo (401 del gateway). Cuando el backend implemente su lado, esta
// pantalla funciona sin cambios. Ver docs/contratos-backend.md, fila 6.

import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
  ESTADO_COMPRA_REVISION_REQUERIDA,
  parsearRetornoPago,
  type DatosEntregaCompra,
  type ItemCarrito as ItemCarritoPago,
} from '../../services/pagos';

type Vista = 'revision' | 'revision_requerida' | 'realizada' | 'fallo';
type MetodoEntrega = 'retiro' | 'envio';

// Envío estándar (3-5 días) según el mockup. El retiro en cafetería es sin
// costo y es el método por defecto (el modelo de CloudCoffee es retiro).
const DESPACHO_ENVIO = 4990;
// Mensaje del estado 401/403 según la especificación (el aviso de "Nada se
// cobró y tu carrito sigue listo" vive en la vista de fallo, debajo).
const TEXTO_AUTH =
  'Se requiere autenticación válida para acceder a este recurso. Nada se cobró y tu carrito sigue listo.';

interface FormularioEntrega {
  nombre: string;
  correo: string;
  telefono: string;
  direccion: string;
}

function formatearPrecio(precio: number): string {
  return `$${precio.toLocaleString('es-CL')}`;
}

function validarFormulario(form: FormularioEntrega, metodo: MetodoEntrega): Record<string, string> {
  const errores: Record<string, string> = {};

  if (form.nombre.trim().length < 3) {
    errores.nombre = 'Ingresa tu nombre completo.';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.correo.trim())) {
    errores.correo = 'Ingresa un correo electrónico válido.';
  }

  const digitos = form.telefono.replace(/\D/g, '');
  if (digitos.length < 7 || digitos.length > 15) {
    errores.telefono = 'Ingresa un teléfono válido (solo números).';
  }

  // La dirección física solo aplica cuando elige envío a domicilio.
  if (metodo === 'envio' && form.direccion.trim().length < 10) {
    errores.direccion = 'Ingresa tu dirección de envío.';
  }

  return errores;
}

export default function CheckoutScreen() {
  const router = useRouter();
  const { items, total, unidades, grupos, vaciar } = useCarrito();

  const params = useLocalSearchParams<{
    estado?: string;
    mensaje?: string;
    compraId?: string;
    montoTotal?: string;
  }>();

  // La vista arranca donde la deje el flujo (o el parámetro para demos/tests):
  // "revision" muestra el resumen; "realizada", "revision_requerida" y "fallo"
  // el resultado de mandar la compra. Es una sola pantalla: no hay ruta aparte
  // para el resultado.
  const [vista, setVista] = useState<Vista>(() => {
    if (
      params.estado === 'realizada' ||
      params.estado === 'revision_requerida' ||
      params.estado === 'fallo'
    ) {
      return params.estado;
    }
    return 'revision';
  });
  const [compraId, setCompraId] = useState<string | undefined>(params.compraId);
  const [montoTotal, setMontoTotal] = useState<number | undefined>(
    params.montoTotal ? Number(params.montoTotal) : undefined
  );
  const [mensajeError, setMensajeError] = useState<string | undefined>(params.mensaje);
  const [procesando, setProcesando] = useState(false);

  // Datos de entrega y facturación (formulario validado al confirmar).
  const [formulario, setFormulario] = useState<FormularioEntrega>({
    nombre: '',
    correo: '',
    telefono: '',
    direccion: '',
  });
  const [metodoEntrega, setMetodoEntrega] = useState<MetodoEntrega>('retiro');
  const [errores, setErrores] = useState<Record<string, string>>({});

  const cambiarCampo = useCallback((campo: keyof FormularioEntrega, valor: string): void => {
    setFormulario((prev) => ({ ...prev, [campo]: valor }));
    // Al editar se limpia el error de ese campo: el usuario ya lo está viendo.
    setErrores((prev) => (prev[campo] ? { ...prev, [campo]: '' } : prev));
  }, []);

  const despacho = metodoEntrega === 'envio' ? DESPACHO_ENVIO : 0;
  const totalAPagar = total + despacho;

  const confirmar = useCallback(async (): Promise<void> => {
    // 1) Validación local antes de tocar el backend: no se envía un pedido sin
    //    los datos de entrega completos.
    const erroresForm = validarFormulario(formulario, metodoEntrega);
    setErrores(erroresForm);
    if (Object.values(erroresForm).some(Boolean)) {
      return;
    }

    setProcesando(true);

    try {
      // 2) Sin sesión no hay token que mandar. No se intenta la llamada: el
      //    httpClient solo inyecta el Authorization cuando hay token, y un 401
      //    sin sesión que se pueda refrescar produce un error que no dice nada.
      const accessToken = getAccessToken();
      if (!accessToken) {
        setMensajeError(TEXTO_AUTH);
        setVista('fallo');
        return;
      }

      // 3) El payload es solo ofertaId y cantidad (el precio no viaja: lo
      //    recalcula el backend contra el catálogo) más los datos de entrega y
      //    facturación recopilados por esta pantalla.
      const payload: ItemCarritoPago[] = items.map((linea) => ({
        ofertaId: linea.ofertaId,
        cantidad: linea.cantidad,
      }));

      const datosEntrega: DatosEntregaCompra = {
        nombre: formulario.nombre.trim(),
        correo: formulario.correo.trim(),
        telefono: formulario.telefono.trim(),
        metodoEntrega,
        ...(formulario.direccion.trim() ? { direccion: formulario.direccion.trim() } : {}),
      };

      const compra = await crearCompra(payload, accessToken, datosEntrega);

      // 4) La orden ya existe del lado del servidor, así que el carrito se vacía
      //    acá y no cuando el pago vuelve: si no se vaciara, volver al carrito y
      //    pagar de nuevo crearía una segunda orden por los mismos productos.
      //    Vaciar no afirma que el pago se haya hecho —la confirmación llega por
      //    webhook— solo que el carrito se convirtió en una orden.
      vaciar();

      // INT4-36: el backend puede responder que la compra quedó registrada
      // pero en revisión. No está confirmada ("realizada") ni es un fallo: la
      // misma pantalla muestra la vista de revisión con el número de orden.
      // Se chequea ANTES del initPoint: una compra en revisión no debe abrir
      // Mercado Pago ni ofrecer pagar de nuevo.
      if (compra.estado === ESTADO_COMPRA_REVISION_REQUERIDA) {
        setCompraId(compra.compraId);
        setMontoTotal(compra.montoTotal);
        setVista('revision_requerida');
        return;
      }

      // Sin initPoint no hay checkout que abrir: la compra quedó registrada y no
      // requiere pago en línea, así que la pantalla muestra la confirmación con
      // el número de orden (el usuario la ve también en Mis Compras).
      if (!compra.initPoint) {
        setCompraId(compra.compraId);
        setMontoTotal(compra.montoTotal);
        setVista('realizada');
        return;
      }

      // 5) Con pago pendiente, el pago se hace acá, en el flujo del carrito: se
      //    abre Mercado Pago con el initPoint que devolvió el backend y el
      //    comprobante lo confirma resultado-pago al volver del navegador.
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

      // 6) 401/403 → mensaje de autenticación de la especificación; cualquier
      //    otro error (400/500, red) → mensaje contextual del backend. Nada se
      //    registró y el carrito queda intacto: la misma pantalla pasa a la
      //    vista de fallo.
      const esAuth = apiError.status === 401 || apiError.status === 403;
      setMensajeError(esAuth ? TEXTO_AUTH : apiError.message);
      setVista('fallo');
    } finally {
      setProcesando(false);
    }
  }, [items, formulario, metodoEntrega, vaciar, router]);

  const volverAlCarrito = useCallback((): void => {
    router.back();
  }, [router]);

  // Una cafetería: se retira en ese punto. Varias: el pedido se coordina en
  // varios, que es lo que el backend va a tener que generar como órdenes.
  const origen =
    grupos.length > 1
      ? `📍 Retiro programado en ${grupos.length} puntos de entrega`
      : grupos.length === 1
        ? `📍 Retiro en: ${grupos[0].cafeteriaNombre}`
        : 'Carrito sin productos';

  let contenido: ReactNode;

  if (vista === 'revision_requerida') {
    // INT4-36: el backend registró la compra pero la dejó en revisión. No es
    // un éxito ("realizada") ni un fallo: se avisa que quedó en revisión, con
    // el número de orden y sin ofrecer pagar de nuevo (misma pantalla).
    contenido = (
      <ScrollView
        contentContainerStyle={styles.resultadoContenido}
        showsVerticalScrollIndicator={false}
        testID="checkout-revision-requerida"
      >
        <View style={styles.iconoWrap}>
          <Text style={styles.icono}>🟡</Text>
        </View>

        <Text
          style={[styles.resultadoTitulo, styles.tituloRevision]}
          testID="checkout-revision-requerida-titulo"
        >
          Tu compra está en revisión
        </Text>

        <Text style={styles.resultadoMensaje} testID="checkout-revision-requerida-mensaje">
          Recibimos tu compra, pero antes de confirmarla necesita una revisión. No se cobrará de
          nuevo por esta pantalla: te avisaremos cuando se resuelva y podrás seguirla en Mis
          compras.
        </Text>

        <View style={styles.resultadoTarjeta} testID="checkout-revision-requerida-detalle">
          <View style={styles.detalleFila}>
            <Text style={styles.detalleLabel}>N° de orden</Text>
            <Text style={styles.detalleValor} testID="checkout-revision-requerida-compra">
              {compraId}
            </Text>
          </View>
          <View style={styles.detalleFila}>
            <Text style={styles.detalleLabel}>Total</Text>
            <Text style={styles.detalleTotal} testID="checkout-revision-requerida-total">
              {formatearPrecio(montoTotal ?? 0)}
            </Text>
          </View>
        </View>

        <Text style={styles.resultadoAviso} testID="checkout-revision-requerida-aviso">
          El estado se actualizará en Mis compras cuando termine la revisión.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.btnPrimario, pressed && styles.btnPresionado]}
          onPress={() => router.replace('/mis-compras')}
          testID="checkout-revision-requerida-ir-compras"
        >
          <Text style={styles.btnPrimarioTexto}>Ver mis compras</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btnSecundario, pressed && styles.btnPresionado]}
          onPress={() => router.replace('/')}
          testID="checkout-revision-requerida-volver-catalogo"
        >
          <Text style={styles.btnSecundarioTexto}>Volver al catálogo</Text>
        </Pressable>
      </ScrollView>
    );
  } else if (vista === 'realizada') {
    contenido = (
      <ScrollView
        contentContainerStyle={styles.resultadoContenido}
        showsVerticalScrollIndicator={false}
        testID="checkout-realizada"
      >
        <View style={styles.iconoWrap}>
          <Text style={styles.icono}>🛍️</Text>
        </View>

        <Text
          style={[styles.resultadoTitulo, styles.tituloExito]}
          testID="checkout-realizada-titulo"
        >
          ¡Compra realizada!
        </Text>

        <Text style={styles.resultadoMensaje} testID="checkout-realizada-mensaje">
          Tu compra llegó al backend y quedó registrada correctamente. No es necesario volver a
          pagar: puedes verla en Mis compras.
        </Text>

        <View style={styles.resultadoTarjeta} testID="checkout-realizada-detalle">
          <View style={styles.detalleFila}>
            <Text style={styles.detalleLabel}>N° de orden</Text>
            <Text style={styles.detalleValor} testID="checkout-realizada-compra">
              {compraId}
            </Text>
          </View>
          <View style={styles.detalleFila}>
            <Text style={styles.detalleLabel}>Total</Text>
            <Text style={styles.detalleTotal} testID="checkout-realizada-total">
              {formatearPrecio(montoTotal ?? 0)}
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.btnPrimario, pressed && styles.btnPresionado]}
          onPress={() => router.replace('/mis-compras')}
          testID="checkout-realizada-ir-compras"
        >
          <Text style={styles.btnPrimarioTexto}>Ver mis compras</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btnSecundario, pressed && styles.btnPresionado]}
          onPress={() => router.replace('/')}
          testID="checkout-realizada-volver-catalogo"
        >
          <Text style={styles.btnSecundarioTexto}>Volver al catálogo</Text>
        </Pressable>
      </ScrollView>
    );
  } else if (vista === 'fallo') {
    contenido = (
      <ScrollView
        contentContainerStyle={styles.resultadoContenido}
        showsVerticalScrollIndicator={false}
        testID="checkout-fallo"
      >
        <View style={styles.iconoWrap}>
          <Text style={styles.icono}>⚠️</Text>
        </View>

        <Text style={[styles.resultadoTitulo, styles.tituloFallo]} testID="checkout-fallo-titulo">
          No pudimos realizar tu compra
        </Text>

        <Text style={styles.resultadoMensaje} testID="checkout-fallo-mensaje">
          {mensajeError ?? 'La compra no llegó al backend, así que no se registró nada.'}
        </Text>

        <Text style={styles.resultadoAviso} testID="checkout-fallo-aviso">
          Nada se cobró y tu carrito sigue listo para que lo intentes de nuevo.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.btnPrimario, pressed && styles.btnPresionado]}
          onPress={() => {
            setMensajeError(undefined);
            setErrores({});
            setVista('revision');
          }}
          testID="checkout-fallo-reintentar"
        >
          <Text style={styles.btnPrimarioTexto}>Volver a intentar</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btnSecundario, pressed && styles.btnPresionado]}
          onPress={() => router.replace('/carrito')}
          testID="checkout-fallo-volver-carrito"
        >
          <Text style={styles.btnSecundarioTexto}>Volver al carrito</Text>
        </Pressable>
      </ScrollView>
    );
  } else if (items.length === 0) {
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
        keyboardShouldPersistTaps="handled"
        testID="checkout-scroll"
      >
        <View style={styles.progreso} testID="checkout-progreso">
          <View style={[styles.paso, styles.pasoCompletado]}>
            <Text style={styles.pasoTexto}>1. Carrito ✓</Text>
          </View>
          <View style={styles.pasoLinea} />
          <View style={[styles.paso, styles.pasoCompletado]}>
            <Text style={styles.pasoTexto}>2. Información ✓</Text>
          </View>
          <View style={styles.pasoLinea} />
          <View style={[styles.paso, styles.pasoActivo]}>
            <Text style={styles.pasoTextoActivo}>3. Pago & Revisión</Text>
          </View>
        </View>

        {/* Resumen del pedido: total a pagar + líneas por punto de retiro */}
        <View style={styles.resumenCabecera} testID="checkout-resumen">
          <Text style={styles.resumenLabel}>
            {unidades} {unidades === 1 ? 'producto' : 'productos'} ·{' '}
            {grupos.length === 1 ? '1 punto de retiro' : `${grupos.length} puntos de retiro`}
          </Text>
          <Text style={styles.total} testID="checkout-total">
            {formatearPrecio(totalAPagar)}
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

        {/* Desglose de precios: subtotal, despacho, impuestos y total final */}
        <View style={styles.desglose} testID="checkout-desglose">
          <View style={styles.desgloseFila}>
            <Text style={styles.desgloseTexto}>Subtotal</Text>
            <Text style={styles.desgloseValor} testID="checkout-desglose-subtotal">
              {formatearPrecio(total)}
            </Text>
          </View>
          <View style={styles.desgloseFila}>
            <Text style={styles.desgloseTexto}>
              {metodoEntrega === 'envio'
                ? 'Despacho · Envío estándar (3-5 días)'
                : 'Despacho · Retiro en cafetería'}
            </Text>
            <Text style={styles.desgloseValor} testID="checkout-desglose-despacho">
              {metodoEntrega === 'envio' ? formatearPrecio(DESPACHO_ENVIO) : '$0'}
            </Text>
          </View>
          <View style={styles.desgloseFila}>
            <Text style={styles.desgloseTexto}>Impuestos</Text>
            <Text style={styles.desgloseValor} testID="checkout-desglose-impuestos">
              Incluidos
            </Text>
          </View>
        </View>

        {/* Datos de entrega y facturación (campos validados) */}
        <View style={styles.formSeccion} testID="checkout-form-entrega">
          <Text style={styles.seccionTitulo}>Datos de entrega y facturación</Text>

          <Text style={styles.campoLabel}>Método de entrega</Text>
          <View style={styles.metodoEntrega}>
            <Pressable
              style={({ pressed }) => [
                styles.opcionEntrega,
                metodoEntrega === 'retiro' && styles.opcionEntregaActiva,
                pressed && styles.btnPresionado,
              ]}
              onPress={() => setMetodoEntrega('retiro')}
              testID="checkout-metodo-retiro"
            >
              <Text style={styles.opcionEntregaIcono}>🏪</Text>
              <View style={styles.opcionEntregaInfo}>
                <Text style={styles.opcionEntregaNombre}>Retiro en cafetería</Text>
                <Text style={styles.opcionEntregaDetalle}>Sin costo</Text>
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.opcionEntrega,
                metodoEntrega === 'envio' && styles.opcionEntregaActiva,
                pressed && styles.btnPresionado,
              ]}
              onPress={() => setMetodoEntrega('envio')}
              testID="checkout-metodo-envio"
            >
              <Text style={styles.opcionEntregaIcono}>🚚</Text>
              <View style={styles.opcionEntregaInfo}>
                <Text style={styles.opcionEntregaNombre}>Envío estándar (3-5 días)</Text>
                <Text style={styles.opcionEntregaDetalle}>{formatearPrecio(DESPACHO_ENVIO)}</Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.campoLabel}>Nombre completo</Text>
            <TextInput
              value={formulario.nombre}
              onChangeText={(valor) => cambiarCampo('nombre', valor)}
              placeholder="Ej: María Fernanda López"
              placeholderTextColor="#A89F95"
              autoCapitalize="words"
              style={[styles.input, errores.nombre ? styles.inputError : null]}
              testID="checkout-nombre"
            />
            {!!errores.nombre && (
              <Text style={styles.campoError} testID="checkout-error-nombre">
                {errores.nombre}
              </Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.campoLabel}>Correo electrónico</Text>
            <TextInput
              value={formulario.correo}
              onChangeText={(valor) => cambiarCampo('correo', valor)}
              placeholder="ejemplo@ca.cloudcoffee.cl"
              placeholderTextColor="#A89F95"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={[styles.input, errores.correo ? styles.inputError : null]}
              testID="checkout-correo"
            />
            {!!errores.correo && (
              <Text style={styles.campoError} testID="checkout-error-correo">
                {errores.correo}
              </Text>
            )}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.campoLabel}>Teléfono de contacto</Text>
            <TextInput
              value={formulario.telefono}
              onChangeText={(valor) => cambiarCampo('telefono', valor)}
              placeholder="+56 9 1234 5678"
              placeholderTextColor="#A89F95"
              keyboardType="phone-pad"
              style={[styles.input, errores.telefono ? styles.inputError : null]}
              testID="checkout-telefono"
            />
            {!!errores.telefono && (
              <Text style={styles.campoError} testID="checkout-error-telefono">
                {errores.telefono}
              </Text>
            )}
          </View>

          {metodoEntrega === 'envio' ? (
            <View style={styles.inputGroup}>
              <Text style={styles.campoLabel}>Dirección de envío</Text>
              <TextInput
                value={formulario.direccion}
                onChangeText={(valor) => cambiarCampo('direccion', valor)}
                placeholder="Calle, número, comuna, ciudad"
                placeholderTextColor="#A89F95"
                autoCapitalize="words"
                style={[styles.input, errores.direccion ? styles.inputError : null]}
                testID="checkout-direccion"
              />
              {!!errores.direccion && (
                <Text style={styles.campoError} testID="checkout-error-direccion">
                  {errores.direccion}
                </Text>
              )}
            </View>
          ) : (
            <Text style={styles.retiroRecap} testID="checkout-entrega-detalle">
              {origen}
            </Text>
          )}
        </View>

        {/* Método de pago: pasarela integrada (la tarjeta se ingresa en MP) */}
        <View style={styles.pagoSeccion} testID="checkout-pago-seccion">
          <Text style={styles.seccionTitulo}>Método de Pago</Text>
          <View style={styles.metodoPago} testID="checkout-metodo-pago">
            <Text style={styles.metodoPagoIcono}>💙</Text>
            <View style={styles.metodoPagoInfo}>
              <Text style={styles.metodoPagoNombre}>Mercado Pago</Text>
              <Text style={styles.metodoPagoDetalle}>
                Vas a pagar en el sitio de Mercado Pago, con tarjeta o saldo. La app no maneja los
                datos de tu tarjeta.
              </Text>
            </View>
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
              {`Confirmar y Pagar ${formatearPrecio(totalAPagar)}`}
            </Text>
          )}
        </Pressable>

        <Text style={styles.nota}>
          Al confirmar se validan tus datos, se envía la compra al backend y, si hay pago pendiente,
          se abre Mercado Pago. El pago se confirma cuando Mercado Pago nos avisa, no al volver a la
          app.
        </Text>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      {vista === 'revision' && (
        <Pressable
          style={({ pressed }) => [styles.botonVolver, pressed && styles.btnPresionado]}
          onPress={volverAlCarrito}
          testID="checkout-volver"
        >
          <Text style={styles.botonVolverTexto}>← Volver al carrito</Text>
        </Pressable>
      )}

      {vista === 'revision' && (
        <View style={styles.header}>
          <Text style={styles.badge}>CHECKOUT</Text>
          <Text style={styles.titulo}>Pago y Revisión</Text>
          <Text style={styles.subtitulo}>
            Confirma tus datos, la entrega y el método de pago antes de finalizar la compra.
          </Text>
        </View>
      )}

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

  // Progreso de pasos (mockup: 1. Carrito ✓ · 2. Información ✓ · 3. Pago & Revisión)
  progreso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paso: {
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pasoCompletado: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  pasoActivo: {
    backgroundColor: '#0052CC',
  },
  pasoTexto: {
    color: '#1E40AF',
    fontSize: 10,
    fontWeight: '800',
  },
  pasoTextoActivo: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  pasoLinea: {
    flex: 1,
    height: 2,
    backgroundColor: '#DBEAFE',
    borderRadius: 1,
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

  // Desglose de precios (subtotal, despacho, impuestos)
  desglose: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  desgloseFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  desgloseTexto: {
    color: '#6B7280',
    fontSize: 12,
    flex: 1,
  },
  desgloseValor: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '800',
  },

  // Datos de entrega y facturación
  formSeccion: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  seccionTitulo: {
    color: '#1D2433',
    fontSize: 14,
    fontWeight: '800',
  },
  campoLabel: {
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '700',
  },
  inputGroup: {
    gap: 6,
  },
  input: {
    backgroundColor: '#FAF7F2',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#1D2433',
    fontSize: 14,
  },
  inputError: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFF8F6',
  },
  campoError: {
    color: '#D32F2F',
    fontSize: 11,
    lineHeight: 15,
  },
  metodoEntrega: {
    gap: 8,
  },
  opcionEntrega: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  opcionEntregaActiva: {
    borderColor: '#0052CC',
    backgroundColor: '#F3F8FE',
  },
  opcionEntregaIcono: {
    fontSize: 18,
  },
  opcionEntregaInfo: {
    flex: 1,
    gap: 2,
  },
  opcionEntregaNombre: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '700',
  },
  opcionEntregaDetalle: {
    color: '#6B7280',
    fontSize: 11,
  },
  retiroRecap: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 17,
  },

  // Método de pago (pasarela integrada; la tarjeta se ingresa en Mercado Pago)
  pagoSeccion: {
    gap: 8,
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
  btnSecundario: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#DBEAFE',
    backgroundColor: '#EFF6FF',
  },
  btnSecundarioTexto: {
    color: '#1E40AF',
    fontSize: 15,
    fontWeight: '700',
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

  // Resultado: vista "realizada" y "fallo" de la MISMA pantalla (no una ruta).
  resultadoContenido: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
    gap: 12,
  },
  iconoWrap: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 40,
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  icono: {
    fontSize: 40,
  },
  resultadoTitulo: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  tituloExito: {
    color: '#0052CC',
  },
  // Ámbar de "revisión requerida" (mismo tono que la pill de Mis Compras).
  tituloRevision: {
    color: '#92400E',
  },
  tituloFallo: {
    color: '#D32F2F',
  },
  resultadoMensaje: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  resultadoAviso: {
    color: '#9CA3AF',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  resultadoTarjeta: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 14,
    gap: 8,
    marginTop: 10,
  },
  detalleFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  detalleLabel: {
    color: '#6B7280',
    fontSize: 12,
  },
  detalleValor: {
    color: '#1D2433',
    fontSize: 13,
    fontWeight: '700',
  },
  detalleTotal: {
    color: '#0052CC',
    fontSize: 18,
    fontWeight: '900',
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
