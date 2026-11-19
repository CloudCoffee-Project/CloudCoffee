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
//   - Datos de entrega y facturación: campos validados (nombre completo, correo y
//     teléfono). No hay dirección porque CloudCoffee solo retira en cafetería, así
//     que el método de entrega se informa en vez de elegirse y el despacho es $0.
//   - Método de pago (INT4-128): PAGO SIMULADO de Order. El cliente elige el
//     escenario (aprobar / rechazar / pendiente) y Order decide el estado real.
//     No hay Mercado Pago, initPoint, navegador de pago ni webhooks externos.
//   - Botón principal "Confirmar y Pagar $X": al pulsarlo entra en estado de
//     carga (spinner + deshabilitado) para evitar dobles envíos o dobles cobros.
//
// Lógica y envío:
//   El botón valida primero los datos de entrega; si algo falta, muestra el
//   error debajo del campo sin llamar al backend. Con el formulario válido
//   dispara POST /v1/compras con { items } y luego POST
//   /v1/compras/{compraId}/pago con el escenario elegido.
//
// Estados de pago (los devuelve Order, no los inventa la app):
//   - aprobado: la compra se concretó → se vacía el carrito y resultado-pago
//     consulta el estado real y lleva al QR de retiro con el compraId.
//   - rechazado: NO se vacía el carrito → resultado-pago ofrece volver a
//     intentar sin perder los productos.
//   - pendiente: queda una orden en vivo; resultado-pago lleva al seguimiento.
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
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Presionable } from '../../components/Presionable';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';

import { useCarrito } from '../../context/CarritoContext';
import { ApiProblem, getAccessToken, toApiError } from '../../services/httpClient';
// ItemCarrito de pagos es el payload de POST /v1/compras (solo ofertaId y
// cantidad) y no la línea del carrito de types/domain, que trae además el nombre
// y el precio. Se importa con alias para que no se confundan los dos.
import {
  crearCompra,
  ESTADO_COMPRA_REVISION_REQUERIDA,
  simularPago,
  type DatosEntregaCompra,
  type ItemCarrito as ItemCarritoPago,
} from '../../services/pagos';
import { tokens } from '../../theme/tokens';
import type { EscenarioPago } from '../../types/domain';

type Vista = 'revision' | 'revision_requerida' | 'realizada' | 'fallo';

// CloudCoffee solo retira en cafetería: no hay envío a domicilio, así que no hay
// método de entrega que elegir ni despacho que sumar. El retiro es siempre el
// punto de retiro donde está cada cafetería del carrito.
const METODO_ENTREGA = 'retiro' as const;

// INT4-128: el pago simulado de Order tiene tres escenarios elegibles. La app
// solo envía el valor al backend; no decide el estado ni genera comprobantes.
const ESCENARIOS_PAGO: readonly {
  valor: EscenarioPago;
  etiqueta: string;
  detalle: string;
  icono: string;
}[] = [
  { valor: 'aprobar', etiqueta: 'Aprobar', detalle: 'Pago aprobado', icono: '✅' },
  { valor: 'rechazar', etiqueta: 'Rechazar', detalle: 'Pago rechazado', icono: '❌' },
  { valor: 'pendiente', etiqueta: 'Pendiente', detalle: 'Pago en proceso', icono: '⏳' },
];

// Mensaje del estado 401/403 según la especificación (el aviso de "Nada se
// cobró y tu carrito sigue listo" vive en la vista de fallo, debajo).
const TEXTO_AUTH =
  'Se requiere autenticación válida para acceder a este recurso. Nada se cobró y tu carrito sigue listo.';

interface FormularioEntrega {
  nombre: string;
  correo: string;
  telefono: string;
}

function formatearPrecio(precio: number): string {
  return `$${precio.toLocaleString('es-CL')}`;
}

function validarFormulario(form: FormularioEntrega): Record<string, string> {
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
  // Escenario del pago simulado. 'aprobar' es el default para no trabar el
  // camino feliz; el usuario puede elegir otro antes de confirmar.
  const [escenario, setEscenario] = useState<EscenarioPago>('aprobar');

  // Datos de entrega y facturación (formulario validado al confirmar).
  const [formulario, setFormulario] = useState<FormularioEntrega>({
    nombre: '',
    correo: '',
    telefono: '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});

  const cambiarCampo = useCallback((campo: keyof FormularioEntrega, valor: string): void => {
    setFormulario((prev) => ({ ...prev, [campo]: valor }));
    // Al editar se limpia el error de ese campo: el usuario ya lo está viendo.
    setErrores((prev) => (prev[campo] ? { ...prev, [campo]: '' } : prev));
  }, []);

  const confirmar = useCallback(async (): Promise<void> => {
    // 1) Validación local antes de tocar el backend: no se envía un pedido sin
    //    los datos de entrega completos.
    const erroresForm = validarFormulario(formulario);
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
        metodoEntrega: METODO_ENTREGA,
      };

      const compra = await crearCompra(payload, accessToken, datosEntrega);

      // INT4-36: el backend puede responder que la compra quedó registrada
      // pero en revisión. No está confirmada ("realizada") ni es un fallo: la
      // misma pantalla muestra la vista de revisión con el número de orden.
      // Se chequea ANTES del pago: una compra en revisión todavía no se puede
      // cobrar ni ofrecer pagar de nuevo.
      if (compra.estado === ESTADO_COMPRA_REVISION_REQUERIDA) {
        // Acá sí existe una orden del lado del servidor: el carrito se vacía
        // para que no se compre dos veces lo que ya está en revisión.
        vaciar();
        setCompraId(compra.compraId);
        setMontoTotal(compra.montoTotal);
        setVista('revision_requerida');
        return;
      }

      // 4) Pago simulado de Order: el backend decide el estado final. No se
      //    abre navegador, no hay initPoint ni se espera un webhook externo.
      const pago = await simularPago(compra.compraId, escenario);

      // 5) El carrito NO se vacía al crear la orden sino una vez conocido el
      //    resultado. Con rechazo (y con pendiente) el usuario puede volver al
      //    carrito sin perder sus productos; solo un pago aprobado convierte
      //    el carrito en compra concretada.
      if (pago.estado === 'aprobado') {
        vaciar();
      }

      // replace y no push: volver atrás desde el resultado no debe devolver al
      // checkout, que volvería a ofrecer pagar una orden ya creada. El CompraId
      // viaja siempre: resultado-pago consulta el estado real con él y decide
      // el destino (QR, orden en vivo o carrito).
      router.replace({
        pathname: '/resultado-pago',
        params: { compraId: compra.compraId, pagoId: pago.pagoId },
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
  }, [items, formulario, escenario, vaciar, router]);

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

        <Presionable
          style={styles.btnPrimario}
          onPress={() => router.replace('/mis-compras')}
          testID="checkout-revision-requerida-ir-compras"
        >
          <Text style={styles.btnPrimarioTexto}>Ver mis compras</Text>
        </Presionable>

        <Presionable
          style={styles.btnSecundario}
          onPress={() => router.replace('/')}
          testID="checkout-revision-requerida-volver-catalogo"
        >
          <Text style={styles.btnSecundarioTexto}>Volver al catálogo</Text>
        </Presionable>
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

        <Presionable
          style={styles.btnPrimario}
          onPress={() => router.replace('/mis-compras')}
          testID="checkout-realizada-ir-compras"
        >
          <Text style={styles.btnPrimarioTexto}>Ver mis compras</Text>
        </Presionable>

        <Presionable
          style={styles.btnSecundario}
          onPress={() => router.replace('/')}
          testID="checkout-realizada-volver-catalogo"
        >
          <Text style={styles.btnSecundarioTexto}>Volver al catálogo</Text>
        </Presionable>
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

        <Presionable
          style={styles.btnPrimario}
          onPress={() => {
            setMensajeError(undefined);
            setErrores({});
            setVista('revision');
          }}
          testID="checkout-fallo-reintentar"
        >
          <Text style={styles.btnPrimarioTexto}>Volver a intentar</Text>
        </Presionable>

        <Presionable
          style={styles.btnSecundario}
          onPress={() => router.replace('/carrito')}
          testID="checkout-fallo-volver-carrito"
        >
          <Text style={styles.btnSecundarioTexto}>Volver al carrito</Text>
        </Presionable>
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
        <Presionable
          style={styles.btnPrimario}
          onPress={() => router.replace('/(cliente)')}
          testID="checkout-ir-catalogo"
        >
          <Text style={styles.btnPrimarioTexto}>Explorar Catálogo</Text>
        </Presionable>
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

        {/* Desglose de precios: subtotal, despacho, impuestos y total final */}
        <View style={styles.desglose} testID="checkout-desglose">
          <View style={styles.desgloseFila}>
            <Text style={styles.desgloseTexto}>Subtotal</Text>
            <Text style={styles.desgloseValor} testID="checkout-desglose-subtotal">
              {formatearPrecio(total)}
            </Text>
          </View>
          <View style={styles.desgloseFila}>
            <Text style={styles.desgloseTexto}>Despacho · Retiro en cafetería</Text>
            <Text style={styles.desgloseValor} testID="checkout-desglose-despacho">
              $0
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

          {/* Sin envío a domicilio no hay nada que elegir: el retiro en
              cafetería es el único método, así que se informa en vez de fingir
              un selector con una sola opción. */}
          <Text style={styles.campoLabel}>Método de entrega</Text>
          <View
            style={[styles.opcionEntrega, styles.opcionEntregaActiva]}
            testID="checkout-metodo-retiro"
          >
            <Text style={styles.opcionEntregaIcono}>🏪</Text>
            <View style={styles.opcionEntregaInfo}>
              <Text style={styles.opcionEntregaNombre}>Retiro en cafetería</Text>
              <Text style={styles.opcionEntregaDetalle} testID="checkout-entrega-detalle">
                {origen}
              </Text>
            </View>
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
        </View>

        {/* INT4-128: pago simulado de Order, sin navegador ni pasarela externa */}
        <View style={styles.pagoSeccion} testID="checkout-pago-seccion">
          <Text style={styles.seccionTitulo}>Método de Pago</Text>
          <View style={styles.metodoPago} testID="checkout-metodo-pago">
            <Text style={styles.metodoPagoIcono}>🧪</Text>
            <View style={styles.metodoPagoInfo}>
              <Text style={styles.metodoPagoNombre}>Pago simulado</Text>
              <Text style={styles.metodoPagoDetalle}>
                Order confirma el resultado. Elegí el escenario que querés probar: no se usa Mercado
                Pago ni se abre un navegador.
              </Text>
            </View>
          </View>
          <View style={styles.escenarios}>
            {ESCENARIOS_PAGO.map((opcion) => {
              const seleccionado = escenario === opcion.valor;
              return (
                <Presionable
                  key={opcion.valor}
                  style={[styles.escenario, seleccionado && styles.escenarioSeleccionado]}
                  onPress={() => setEscenario(opcion.valor)}
                  disabled={procesando}
                  testID={`checkout-escenario-${opcion.valor}`}
                >
                  <Text style={styles.escenarioIcono}>{opcion.icono}</Text>
                  <Text
                    style={[styles.escenarioEtiqueta, seleccionado && styles.escenarioTextoActivo]}
                  >
                    {opcion.etiqueta}
                  </Text>
                  <Text style={styles.escenarioDetalle}>{opcion.detalle}</Text>
                </Presionable>
              );
            })}
          </View>
        </View>

        <Presionable
          style={[styles.btnPrimario, styles.btnConfirmar, procesando && styles.btnDeshabilitado]}
          onPress={confirmar}
          disabled={procesando}
          testID="checkout-confirmar"
        >
          {procesando ? (
            <ActivityIndicator color="#FFFFFF" testID="checkout-procesando" />
          ) : (
            <Text style={styles.btnPrimarioTexto} testID="checkout-confirmar-texto">
              {`Confirmar y Pagar ${formatearPrecio(total)}`}
            </Text>
          )}
        </Presionable>

        <Text style={styles.nota}>
          Al confirmar se validan tus datos, se crea la compra en Order y se simula el pago con el
          escenario elegido. La pantalla siguiente consulta el estado real antes de mostrarte el
          retiro o el seguimiento.
        </Text>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      {vista === 'revision' && (
        <Presionable style={styles.botonVolver} onPress={volverAlCarrito} testID="checkout-volver">
          <Text style={styles.botonVolverTexto}>← Volver al carrito</Text>
        </Presionable>
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
    backgroundColor: tokens.colores.fondo,
  },
  botonVolver: {
    alignSelf: 'flex-start',
    paddingHorizontal: tokens.espaciado['2xl'],
    paddingTop: tokens.espaciado.xl,
    paddingBottom: tokens.espaciado.xs,
  },
  botonVolverTexto: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  header: {
    paddingHorizontal: tokens.espaciado['2xl'],
    paddingTop: tokens.espaciado.md,
    paddingBottom: tokens.espaciado.xl,
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
  subtitulo: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
    lineHeight: tokens.tipografia.interlineado.normal,
  },
  contenido: {
    paddingHorizontal: tokens.espaciado['2xl'],
    paddingBottom: tokens.espaciado['5xl'],
    gap: tokens.espaciado.xxl,
  },

  // Progreso de pasos (mockup: 1. Carrito ✓ · 2. Información ✓ · 3. Pago & Revisión)
  progreso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.sm,
  },
  paso: {
    borderRadius: tokens.radios.xl,
    paddingHorizontal: tokens.espaciado.lg,
    paddingVertical: tokens.espaciado.sm,
  },
  pasoCompletado: {
    backgroundColor: tokens.colores.infoSuave,
    borderWidth: tokens.grosores.fino,
    borderColor: tokens.colores.infoChip,
  },
  pasoActivo: {
    backgroundColor: tokens.colores.azul,
  },
  pasoTexto: {
    color: tokens.colores.azulFuerte,
    fontSize: tokens.tipografia.tamano.pie,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  pasoTextoActivo: {
    color: tokens.colores.superficie,
    fontSize: tokens.tipografia.tamano.pie,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  pasoLinea: {
    flex: 1,
    height: tokens.grosores.grueso,
    backgroundColor: tokens.colores.infoChip,
    borderRadius: tokens.radios.pildora,
  },

  // Resumen arriba: el número grande que el usuario viene a confirmar.
  resumenCabecera: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingVertical: tokens.espaciado.xxl,
    gap: tokens.espaciado.xs,
  },
  resumenLabel: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
  },
  total: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.tituloPantalla,
    fontWeight: tokens.tipografia.peso.negro,
    letterSpacing: tokens.tipografia.tracking.apretado,
  },

  grupoCard: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    padding: tokens.espaciado.xxl,
    gap: tokens.espaciado.lg,
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
  itemFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.md,
  },
  itemCantidad: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.extranegrita,
    // Ancho mínimo de la columna de cantidad (layout).
    minWidth: tokens.espaciado['22'],
  },
  itemNombre: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.semibold,
    flex: 1,
  },
  itemSubtotal: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.extranegrita,
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
  },
  grupoSubtotalValor: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },

  // Desglose de precios (subtotal, despacho, impuestos)
  desglose: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    paddingHorizontal: tokens.espaciado.xxxl,
    paddingVertical: tokens.espaciado.xl,
    gap: tokens.espaciado.md,
  },
  desgloseFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.lg,
  },
  desgloseTexto: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
    flex: 1,
  },
  desgloseValor: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },

  // Datos de entrega y facturación
  formSeccion: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    padding: tokens.espaciado.xxxl,
    gap: tokens.espaciado.xl,
  },
  seccionTitulo: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  campoLabel: {
    color: tokens.colores.textoGris,
    fontSize: tokens.tipografia.tamano.detalle,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  inputGroup: {
    gap: tokens.espaciado.sm,
  },
  input: {
    backgroundColor: tokens.colores.fondo,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.lg,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.xl,
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpoMedio,
  },
  inputError: {
    borderColor: tokens.colores.errorFuerte,
    backgroundColor: tokens.colores.errorCampoFondo,
  },
  campoError: {
    color: tokens.colores.errorFuerte,
    fontSize: tokens.tipografia.tamano.etiqueta,
    lineHeight: tokens.tipografia.interlineado.apretado,
  },
  opcionEntrega: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.lg,
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xl,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.lg,
  },
  opcionEntregaActiva: {
    borderColor: tokens.colores.azul,
    backgroundColor: tokens.colores.opcionActivaFondo,
  },
  opcionEntregaIcono: {
    fontSize: tokens.tipografia.tamano.subtitulo,
  },
  opcionEntregaInfo: {
    flex: 1,
    gap: tokens.espaciado.xxs,
  },
  opcionEntregaNombre: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  opcionEntregaDetalle: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.etiqueta,
  },
  // Método de pago (INT4-128): escenarios del pago simulado de Order.
  pagoSeccion: {
    gap: tokens.espaciado.md,
  },
  metodoPago: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.espaciado.xl,
    backgroundColor: tokens.colores.opcionActivaFondo,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.azul,
    borderRadius: tokens.radios.xl,
    paddingHorizontal: tokens.espaciado.xl,
    paddingVertical: tokens.espaciado.xl,
  },
  metodoPagoIcono: {
    fontSize: tokens.tipografia.tamano.encabezado,
  },
  metodoPagoInfo: {
    flex: 1,
    gap: tokens.espaciado.xxs,
  },
  metodoPagoNombre: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  metodoPagoDetalle: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.etiqueta,
    lineHeight: tokens.tipografia.interlineado.apretado,
  },
  escenarios: {
    flexDirection: 'row',
    gap: tokens.espaciado.sm,
  },
  escenario: {
    flex: 1,
    alignItems: 'center',
    gap: tokens.espaciado.xxs,
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.lg,
    paddingVertical: tokens.espaciado.md,
    paddingHorizontal: tokens.espaciado.xs,
  },
  escenarioSeleccionado: {
    borderColor: tokens.colores.azul,
    borderWidth: tokens.grosores.grueso,
    backgroundColor: tokens.colores.opcionActivaFondo,
  },
  escenarioIcono: {
    fontSize: tokens.tipografia.tamano.encabezado,
  },
  escenarioEtiqueta: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.etiqueta,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  escenarioTextoActivo: {
    color: tokens.colores.azul,
  },
  escenarioDetalle: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.etiqueta,
    textAlign: 'center',
  },

  // Botones
  btnPrimario: {
    backgroundColor: tokens.colores.azul,
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado.xxl,
    alignItems: 'center',
  },
  btnPrimarioTexto: {
    color: tokens.colores.superficie,
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.extranegrita,
  },
  btnSecundario: {
    borderRadius: tokens.radios.xl,
    paddingVertical: tokens.espaciado.xxl,
    alignItems: 'center',
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.infoChip,
    backgroundColor: tokens.colores.infoSuave,
  },
  btnSecundarioTexto: {
    color: tokens.colores.azulFuerte,
    fontSize: tokens.tipografia.tamano.boton,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  btnConfirmar: {
    marginTop: tokens.espaciado.xxs,
    paddingVertical: tokens.espaciado['15'],
  },
  btnDeshabilitado: {
    opacity: tokens.estados.deshabilitado,
  },
  nota: {
    color: tokens.colores.textoClaro,
    fontSize: tokens.tipografia.tamano.etiqueta,
    lineHeight: tokens.tipografia.interlineado.normal,
    textAlign: 'center',
  },

  // Resultado: vista "realizada" y "fallo" de la MISMA pantalla (no una ruta).
  resultadoContenido: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: tokens.espaciado['3xl'],
    paddingVertical: tokens.espaciado['6xl'],
    gap: tokens.espaciado.xl,
  },
  iconoWrap: {
    alignSelf: 'center',
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.pildora,
    width: tokens.tamanos.circuloResultado,
    height: tokens.tamanos.circuloResultado,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: tokens.espaciado.xs,
  },
  icono: {
    fontSize: tokens.tipografia.tamano.iconoGrande,
  },
  resultadoTitulo: {
    fontSize: tokens.tipografia.tamano.titulo,
    fontWeight: tokens.tipografia.peso.extranegrita,
    textAlign: 'center',
  },
  tituloExito: {
    color: tokens.colores.azul,
  },
  // Ámbar de "revisión requerida" (mismo tono que la pill de Mis Compras).
  tituloRevision: {
    color: tokens.colores.amarilloTextoOscuro,
  },
  tituloFallo: {
    color: tokens.colores.errorFuerte,
  },
  resultadoMensaje: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.cuerpo,
    lineHeight: tokens.tipografia.interlineado.holgado,
    textAlign: 'center',
  },
  resultadoAviso: {
    color: tokens.colores.textoClaro,
    fontSize: tokens.tipografia.tamano.etiqueta,
    lineHeight: tokens.tipografia.interlineado.normal,
    textAlign: 'center',
  },
  resultadoTarjeta: {
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
    borderColor: tokens.colores.bordeCalido,
    borderRadius: tokens.radios.xxxl,
    padding: tokens.espaciado.xxl,
    gap: tokens.espaciado.md,
    marginTop: tokens.espaciado.lg,
  },
  detalleFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.espaciado.lg,
  },
  detalleLabel: {
    color: tokens.colores.textoNeutro,
    fontSize: tokens.tipografia.tamano.detalle,
  },
  detalleValor: {
    color: tokens.colores.tintaCliente,
    fontSize: tokens.tipografia.tamano.cuerpo,
    fontWeight: tokens.tipografia.peso.negrita,
  },
  detalleTotal: {
    color: tokens.colores.azul,
    fontSize: tokens.tipografia.tamano.subtitulo,
    fontWeight: tokens.tipografia.peso.negro,
  },

  // Vacío
  tarjetaVacio: {
    marginHorizontal: tokens.espaciado['2xl'],
    backgroundColor: tokens.colores.superficie,
    borderWidth: tokens.grosores.medio,
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
});
