// src/app/(cliente)/mis-compras.tsx
//
// "Mis Compras" (INT4-50): historial de compras del cliente (tab propio del
// layout (cliente)). Por cada compra muestra su N°, estado, monto total y las
// órdenes que agrupa; desde una compra pagada se puede abrir la boleta en PDF
// de cada orden (INT4-48, pantalla (cliente)/orden/[id]).
//
// INT4-37: la pantalla es también donde el cliente confirma o cancela, tanto la
// compra completa como una orden puntual. Las acciones aparecen solo en los
// estados que lo permiten (puedeConfirmarCompra/puedeCancelarCompra y
// puedeConfirmarOrden/puedeCancelarOrden, en types/domain.ts): una compra
// pagada o cancelada no ofrece nada, y una orden ya pagada tampoco, porque
// cancelar ahí ya no corresponde al cliente. Cancelar pide confirmación en
// pantalla antes de llamar al backend, y mientras la llamada viaja el botón
// queda deshabilitado para no repetir la acción.
//
// El listado sale de GET /v1/compras (services/compras.ts). El backend aún no
// implementa el controller: la pantalla consume el contrato real y muestra el
// error normalizado (toApiError) si el gateway responde con problem+json, con
// botón de reintento. Se recarga al ganar foco y después de cada acción, para
// reflejar compras creadas en el flujo de pago (carrito → checkout → Mis
// Compras) y el estado que el backend devuelve tras confirmar o cancelar.

import { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AxiosError } from 'axios';

import { cancelarCompra, confirmarCompra, listarCompras } from '../../services/compras';
import { cancelarOrden, confirmarOrden } from '../../services/ordenes';
import { ApiProblem, toApiError } from '../../services/httpClient';
import {
  puedeCancelarCompra,
  puedeCancelarOrden,
  puedeConfirmarCompra,
  puedeConfirmarOrden,
  type Compra,
  type EstadoCompra,
  type Orden,
} from '../../types/domain';

// Etiquetas e identidad de la pill por estado de compra, análogas a las del
// union EstadoOrden (qr-retiro/seguimientos) pero para EstadoCompra. Nunca un
// string plano inventado en la pantalla.
function etiquetaDeEstadoCompra(estado: EstadoCompra): string {
  switch (estado) {
    case 'reservando':
      return '🔵 Reservando';
    case 'revision_requerida':
      return '🟡 Requiere revisión';
    case 'pendiente_pago':
      return '⏳ Pendiente de pago';
    case 'pagado':
      return '🟢 Pagado';
    case 'cancelado':
      return '⚪ Cancelado';
  }
}

function claseEstadoCompra(estado: EstadoCompra): { fondo: string; texto: string } {
  switch (estado) {
    case 'reservando':
      return { fondo: '#DBEAFE', texto: '#1E40AF' };
    case 'revision_requerida':
    case 'pendiente_pago':
      return { fondo: '#FEF3C7', texto: '#92400E' };
    case 'pagado':
      return { fondo: '#DCFCE7', texto: '#166534' };
    case 'cancelado':
      return { fondo: '#F3F4F6', texto: '#6B7280' };
  }
}

function formatoMonto(monto: number): string {
  return `$${monto.toLocaleString('es-CL')}`;
}

// La boleta existe para las órdenes de una compra pagada (INT4-48).
function puedeVerBoleta(compra: Compra): boolean {
  return compra.estado === 'pagado';
}

// INT4-37: qué botón se está ejecutando. Se guarda el id también para poder
// mostrar el spinner solo en el botón pulsado y no en los demás de la lista.
type AccionEnCurso = {
  ambito: 'compra' | 'orden';
  tipo: 'confirmar' | 'cancelar';
  id: string;
};

function claveAccion(ambito: AccionEnCurso['ambito'], id: string): string {
  return `${ambito}:${id}`;
}

export default function MisComprasScreen() {
  const router = useRouter();
  // null = aún cargando el listado inicial.
  const [compras, setCompras] = useState<Compra[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // Estado de las acciones del cliente (INT4-37).
  const [accion, setAccion] = useState<AccionEnCurso | null>(null);
  // Clave de la cancelación que espera confirmación en pantalla ("compra:<id>"
  // u "orden:<id>"); null = no hay ninguna esperando.
  const [cancelacionPorConfirmar, setCancelacionPorConfirmar] = useState<string | null>(null);
  const [mensajeAccion, setMensajeAccion] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    try {
      const lista = await listarCompras();
      setCompras(lista);
      setErrorCarga(null);
    } catch (error) {
      const apiError = toApiError(error as AxiosError<ApiProblem>);
      setCompras(null);
      setErrorCarga(apiError.message);
    }
  }, []);

  // Se recarga al ganar foco: refleja compras creadas en el flujo de pago.
  useFocusEffect(
    useCallback(() => {
      void recargar();
    }, [recargar])
  );

  const reintentar = (): void => {
    void recargar();
  };

  // Ejecuta la acción contra el backend y recarga el historial para mostrar el
  // estado que devuelve. Con una acción en vuelo se ignoran los toques: evita
  // confirmar dos veces o cancelar una compra que ya quedó cancelada.
  const ejecutarAccion = useCallback(
    async (
      ambito: AccionEnCurso['ambito'],
      tipo: AccionEnCurso['tipo'],
      id: string
    ): Promise<void> => {
      if (accion) {
        return;
      }

      setAccion({ ambito, tipo, id });
      setMensajeAccion(null);
      setErrorAccion(null);
      setCancelacionPorConfirmar(null);

      const esCompra = ambito === 'compra';
      const etiqueta = esCompra ? 'la compra' : 'el pedido';

      try {
        if (tipo === 'confirmar') {
          if (esCompra) {
            await confirmarCompra(id);
          } else {
            await confirmarOrden(id);
          }
        } else if (esCompra) {
          await cancelarCompra(id);
        } else {
          await cancelarOrden(id);
        }

        setMensajeAccion(
          tipo === 'confirmar'
            ? `Confirmaste ${etiqueta}. Te avisaremos cuando cambie el estado.`
            : `Cancelaste ${etiqueta}. No se cobró nada por esta acción.`
        );
        await recargar();
      } catch (error) {
        const apiError = toApiError(error as AxiosError<ApiProblem>);
        setErrorAccion(apiError.message);
      } finally {
        setAccion(null);
      }
    },
    [accion, recargar]
  );

  // Cancelar pide confirmación en pantalla antes de tocar el backend: es una
  // acción que el usuario no puede deshacer desde la app.
  const pedirCancelacion = useCallback((ambito: AccionEnCurso['ambito'], id: string): void => {
    setMensajeAccion(null);
    setErrorAccion(null);
    setCancelacionPorConfirmar(claveAccion(ambito, id));
  }, []);

  const abrirBoleta = useCallback(
    (orden: Orden): void => {
      router.push({
        pathname: '/(cliente)/orden/[id]',
        params: { id: orden.ordenId, estado: orden.estado },
      });
    },
    [router]
  );

  let contenido: ReactNode;
  if (errorCarga !== null) {
    contenido = (
      <View style={styles.tarjetaError} testID="compras-error">
        <Text style={styles.errorTitulo}>No pudimos cargar tu historial</Text>
        <Text style={styles.errorMensaje}>{errorCarga}</Text>
        <Pressable
          style={({ pressed }) => [styles.btnReintentar, pressed && styles.btnPresionado]}
          onPress={reintentar}
          testID="reintentar-compras"
        >
          <Text style={styles.btnReintentarTexto}>Reintentar</Text>
        </Pressable>
      </View>
    );
  } else if (compras === null) {
    contenido = (
      <View style={styles.centrado}>
        <ActivityIndicator size="large" color="#0052CC" testID="compras-cargando" />
      </View>
    );
  } else if (compras.length === 0) {
    contenido = (
      <View style={styles.tarjetaVacio} testID="compras-vacio">
        <Text style={styles.vacioIcono}>🛍️</Text>
        <Text style={styles.vacioTitulo}>Aún no tienes compras</Text>
        <Text style={styles.vacioTexto}>
          Cuando realices una compra en el carrito, tu historial aparecerá aquí con sus boletas.
        </Text>
      </View>
    );
  } else {
    contenido = (
      <ScrollView
        contentContainerStyle={styles.contenido}
        showsVerticalScrollIndicator={false}
        testID="lista-compras"
      >
        {mensajeAccion ? (
          <View style={styles.bannerExito} testID="compras-accion-mensaje">
            <Text style={styles.bannerExitoTexto}>{mensajeAccion}</Text>
          </View>
        ) : null}

        {errorAccion ? (
          <View style={styles.bannerError} testID="compras-accion-error">
            <Text style={styles.bannerErrorTitulo}>No pudimos completar la acción</Text>
            <Text style={styles.bannerErrorTexto}>{errorAccion}</Text>
          </View>
        ) : null}

        {compras.map((compra) => {
          const conBoleta = puedeVerBoleta(compra);
          const puedeConfirmar = puedeConfirmarCompra(compra.estado);
          const puedeCancelar = puedeCancelarCompra(compra.estado);
          const hayAcciones = puedeConfirmar || puedeCancelar;
          return (
            <View
              key={compra.compraId}
              style={styles.tarjeta}
              testID={`compra-item-${compra.compraId}`}
            >
              <View style={styles.compraTop}>
                <View style={styles.compraTopInfo}>
                  <Text style={styles.compraLabel}>N° DE COMPRA</Text>
                  <Text style={styles.compraId} numberOfLines={1}>
                    {compra.compraId}
                  </Text>
                </View>
                <View
                  style={[styles.pill, { backgroundColor: claseEstadoCompra(compra.estado).fondo }]}
                >
                  <Text
                    style={[styles.pillTexto, { color: claseEstadoCompra(compra.estado).texto }]}
                  >
                    {etiquetaDeEstadoCompra(compra.estado)}
                  </Text>
                </View>
              </View>

              <View style={styles.compraTotal}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalMonto}>{formatoMonto(compra.montoTotal)}</Text>
              </View>

              <View style={styles.ordenes}>
                {compra.ordenes.map((orden, i) => (
                  <View key={orden.ordenId}>
                    <View style={[styles.ordenFila, i > 0 && styles.ordenFilaBorde]}>
                      <View style={styles.ordenInfo}>
                        <Text style={styles.ordenEtiqueta}>PEDIDO</Text>
                        <Text style={styles.ordenCodigo} numberOfLines={1}>
                          #{orden.codigoOrden}
                        </Text>
                      </View>
                      {conBoleta ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.btnBoleta,
                            pressed && styles.btnPresionado,
                          ]}
                          onPress={() => abrirBoleta(orden)}
                          testID={`boleta-orden-${orden.ordenId}`}
                        >
                          <Text style={styles.btnBoletaTexto}>📄 Boleta</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.ordenMonto}>{formatoMonto(orden.montoTotal)}</Text>
                      )}
                    </View>

                    {/* INT4-37: acciones sobre ESTA orden. Una orden pagada o ya
                        entregada no ofrece nada: la cafetería ya la preparó y no
                        le corresponde cancelar al cliente. */}
                    {(puedeConfirmarOrden(orden.estado) || puedeCancelarOrden(orden.estado)) && (
                      <View style={styles.acciones} testID={`orden-acciones-${orden.ordenId}`}>
                        {puedeConfirmarOrden(orden.estado) ? (
                          <Pressable
                            style={({ pressed }) => [
                              styles.btnAccion,
                              styles.btnAccionPrimario,
                              accion !== null && styles.btnAccionDeshabilitado,
                              pressed && styles.btnPresionado,
                            ]}
                            onPress={() => void ejecutarAccion('orden', 'confirmar', orden.ordenId)}
                            disabled={accion !== null}
                            testID={`orden-confirmar-${orden.ordenId}`}
                          >
                            {accion?.ambito === 'orden' &&
                            accion.id === orden.ordenId &&
                            accion.tipo === 'confirmar' ? (
                              <ActivityIndicator
                                size="small"
                                color="#FFFFFF"
                                testID={`orden-confirmar-cargando-${orden.ordenId}`}
                              />
                            ) : (
                              <Text style={styles.btnAccionPrimarioTexto}>✓ Confirmar pedido</Text>
                            )}
                          </Pressable>
                        ) : null}

                        {puedeCancelarOrden(orden.estado) &&
                          (cancelacionPorConfirmar === claveAccion('orden', orden.ordenId) ? (
                            <View
                              style={styles.confirmacion}
                              testID={`orden-confirmacion-cancelar-${orden.ordenId}`}
                            >
                              <Text style={styles.confirmacionTexto}>
                                ¿Cancelar el pedido #{orden.codigoOrden}?
                              </Text>
                              <View style={styles.confirmacionBotones}>
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.btnAccion,
                                    styles.btnAccionPeligro,
                                    accion !== null && styles.btnAccionDeshabilitado,
                                    pressed && styles.btnPresionado,
                                  ]}
                                  onPress={() =>
                                    void ejecutarAccion('orden', 'cancelar', orden.ordenId)
                                  }
                                  disabled={accion !== null}
                                  testID={`orden-confirmar-cancelacion-${orden.ordenId}`}
                                >
                                  {accion?.ambito === 'orden' &&
                                  accion.id === orden.ordenId &&
                                  accion.tipo === 'cancelar' ? (
                                    <ActivityIndicator
                                      size="small"
                                      color="#FFFFFF"
                                      testID={`orden-cancelar-cargando-${orden.ordenId}`}
                                    />
                                  ) : (
                                    <Text style={styles.btnAccionPeligroTexto}>Sí, cancelar</Text>
                                  )}
                                </Pressable>
                                <Pressable
                                  style={({ pressed }) => [
                                    styles.btnAccion,
                                    pressed && styles.btnPresionado,
                                  ]}
                                  onPress={() => setCancelacionPorConfirmar(null)}
                                  testID={`orden-mantener-${orden.ordenId}`}
                                >
                                  <Text style={styles.btnAccionTexto}>No, mantener</Text>
                                </Pressable>
                              </View>
                            </View>
                          ) : (
                            <Pressable
                              style={({ pressed }) => [
                                styles.btnAccion,
                                styles.btnAccionPeligro,
                                accion !== null && styles.btnAccionDeshabilitado,
                                pressed && styles.btnPresionado,
                              ]}
                              onPress={() => pedirCancelacion('orden', orden.ordenId)}
                              disabled={accion !== null}
                              testID={`orden-cancelar-${orden.ordenId}`}
                            >
                              <Text style={styles.btnAccionPeligroTexto}>Cancelar pedido</Text>
                            </Pressable>
                          ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>

              {/* INT4-37: acciones sobre la COMPRA COMPLETA (sus pedidos
                  incluidos). Solo aparecen mientras la compra lo permita: si ya
                  está pagada o cancelada, la tarjeta queda como histórico. */}
              {hayAcciones ? (
                <View style={styles.acciones} testID={`compra-acciones-${compra.compraId}`}>
                  {puedeConfirmar ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.btnAccion,
                        styles.btnAccionPrimario,
                        accion !== null && styles.btnAccionDeshabilitado,
                        pressed && styles.btnPresionado,
                      ]}
                      onPress={() => void ejecutarAccion('compra', 'confirmar', compra.compraId)}
                      disabled={accion !== null}
                      testID={`compra-confirmar-${compra.compraId}`}
                    >
                      {accion?.ambito === 'compra' &&
                      accion.id === compra.compraId &&
                      accion.tipo === 'confirmar' ? (
                        <ActivityIndicator
                          size="small"
                          color="#FFFFFF"
                          testID={`compra-confirmar-cargando-${compra.compraId}`}
                        />
                      ) : (
                        <Text style={styles.btnAccionPrimarioTexto}>✓ Confirmar compra</Text>
                      )}
                    </Pressable>
                  ) : null}

                  {puedeCancelar ? (
                    cancelacionPorConfirmar === claveAccion('compra', compra.compraId) ? (
                      <View
                        style={styles.confirmacion}
                        testID={`compra-confirmar-cancelacion-${compra.compraId}`}
                      >
                        <Text style={styles.confirmacionTexto}>
                          ¿Cancelar la compra completa y todos sus pedidos?
                        </Text>
                        <View style={styles.confirmacionBotones}>
                          <Pressable
                            style={({ pressed }) => [
                              styles.btnAccion,
                              styles.btnAccionPeligro,
                              accion !== null && styles.btnAccionDeshabilitado,
                              pressed && styles.btnPresionado,
                            ]}
                            onPress={() =>
                              void ejecutarAccion('compra', 'cancelar', compra.compraId)
                            }
                            disabled={accion !== null}
                            testID={`compra-cancelar-confirmado-${compra.compraId}`}
                          >
                            {accion?.ambito === 'compra' &&
                            accion.id === compra.compraId &&
                            accion.tipo === 'cancelar' ? (
                              <ActivityIndicator
                                size="small"
                                color="#FFFFFF"
                                testID={`compra-cancelar-cargando-${compra.compraId}`}
                              />
                            ) : (
                              <Text style={styles.btnAccionPeligroTexto}>Sí, cancelar</Text>
                            )}
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [
                              styles.btnAccion,
                              pressed && styles.btnPresionado,
                            ]}
                            onPress={() => setCancelacionPorConfirmar(null)}
                            testID={`compra-mantener-${compra.compraId}`}
                          >
                            <Text style={styles.btnAccionTexto}>No, mantener</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        style={({ pressed }) => [
                          styles.btnAccion,
                          styles.btnAccionPeligro,
                          accion !== null && styles.btnAccionDeshabilitado,
                          pressed && styles.btnPresionado,
                        ]}
                        onPress={() => pedirCancelacion('compra', compra.compraId)}
                        disabled={accion !== null}
                        testID={`compra-cancelar-${compra.compraId}`}
                      >
                        <Text style={styles.btnAccionPeligroTexto}>✕ Cancelar compra</Text>
                      </Pressable>
                    )
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.pantalla} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>HISTORIAL</Text>
        </View>
        <Text style={styles.title}>Mis Compras</Text>
        <Text style={styles.subtitle}>Revisa tus compras y descarga tus boletas.</Text>
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF8DF',
    borderWidth: 1,
    borderColor: '#F3DC87',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginBottom: 8,
  },
  badgeText: {
    color: '#B28300',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    color: '#0052CC',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  centrado: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  contenido: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    gap: 14,
  },
  tarjeta: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  compraTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE9DE',
    borderStyle: 'dashed',
    paddingBottom: 14,
  },
  compraTopInfo: {
    flex: 1,
  },
  compraLabel: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  compraId: {
    color: '#0052CC',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  pillTexto: {
    fontSize: 11,
    fontWeight: '800',
  },
  compraTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  totalLabel: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '700',
  },
  totalMonto: {
    color: '#1D2433',
    fontSize: 18,
    fontWeight: '900',
  },
  ordenes: {
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 4,
  },
  ordenFila: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  ordenFilaBorde: {
    borderTopWidth: 1,
    borderTopColor: '#F3EEE6',
  },
  ordenInfo: {
    flex: 1,
  },
  ordenEtiqueta: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  ordenCodigo: {
    color: '#1D2433',
    fontSize: 14,
    fontWeight: '800',
  },
  ordenMonto: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '700',
  },
  btnBoleta: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  btnBoletaTexto: {
    color: '#0052CC',
    fontSize: 12,
    fontWeight: '800',
  },
  btnPresionado: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  tarjetaError: {
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  errorTitulo: {
    color: '#1D2433',
    fontSize: 16,
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
    paddingVertical: 12,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  btnReintentarTexto: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  tarjetaVacio: {
    marginHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#EFE9DE',
    borderStyle: 'dashed',
    borderRadius: 18,
    paddingVertical: 48,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  vacioIcono: {
    fontSize: 44,
  },
  vacioTitulo: {
    color: '#1D2433',
    fontSize: 17,
    fontWeight: '800',
  },
  vacioTexto: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },

  // INT4-37: acciones de confirmar/cancelar (compra completa u orden puntual).
  acciones: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#EFE9DE',
    paddingTop: 12,
    marginTop: 2,
  },
  confirmacion: {
    flex: 1,
    gap: 8,
  },
  confirmacionTexto: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 17,
  },
  confirmacionBotones: {
    flexDirection: 'row',
    gap: 8,
  },
  btnAccion: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#DBEAFE',
    backgroundColor: '#EFF6FF',
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 96,
  },
  btnAccionPrimario: {
    backgroundColor: '#0052CC',
    borderColor: '#0052CC',
  },
  btnAccionPrimarioTexto: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  btnAccionPeligro: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  btnAccionPeligroTexto: {
    color: '#B91C1C',
    fontSize: 12,
    fontWeight: '800',
  },
  btnAccionTexto: {
    color: '#1E40AF',
    fontSize: 12,
    fontWeight: '800',
  },
  btnAccionDeshabilitado: {
    opacity: 0.6,
  },

  // Avisos del resultado de la acción (éxito o error del backend).
  bannerExito: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    padding: 12,
  },
  bannerExitoTexto: {
    color: '#065F46',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  bannerError: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
  },
  bannerErrorTitulo: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  bannerErrorTexto: {
    color: '#991B1B',
    fontSize: 13,
    lineHeight: 18,
  },
});
