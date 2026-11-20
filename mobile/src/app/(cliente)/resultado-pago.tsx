// src/app/(cliente)/resultado-pago.tsx
//
// INT4-128 / INT4-130: puente entre el pago simulado de Order y el recorrido de
// retiro. La pantalla NO confía en el estado que venga por params (eso era del
// flujo de Mercado Pago): al ganar foco consulta PRIMERO
// GET /v1/compras/{compraId}/pago y después GET /v1/compras/{compraId} para las
// órdenes. Decide con el pago real del backend:
//   - aprobado  → /(cliente)/qr-retiro con el compraId (el QR lo habilita Order).
//   - pendiente → /(cliente)/seguimientos (orden en vivo con GET + WebSocket).
//   - rechazado → esta misma vista ofrece volver al carrito, que NO se vació.
//   - sin pago / error → vista de "no pudimos confirmar" con reintento.
//
// Reabrir o recargar la pantalla vuelve a consultar: el estado nunca queda
// cacheado en la app.

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { AxiosError } from 'axios';

import { Presionable } from '../../components/Presionable';
import { obtenerCompra } from '../../services/compras';
import { ApiProblem, toApiError } from '../../services/httpClient';
import { consultarPago } from '../../services/pagos';
import type { Compra, EstadoPago } from '../../types/domain';

type Resultado = 'aprobado' | 'rechazado' | 'pendiente' | 'desconocido';

interface ContenidoResultado {
  titulo: string;
  mensaje: string;
  color: string;
  emoji: string;
}

const CONTENIDO_POR_ESTADO: Record<Resultado, ContenidoResultado> = {
  aprobado: {
    titulo: 'Pago aprobado',
    mensaje: 'Order confirmó tu pago. Estamos preparando tu código QR de retiro.',
    color: '#00A650',
    emoji: '✅',
  },
  rechazado: {
    titulo: 'Pago rechazado',
    mensaje:
      'Order rechazó el pago. Tu carrito sigue igual: podés volver a intentar sin perder tus productos.',
    color: '#D32F2F',
    emoji: '❌',
  },
  pendiente: {
    titulo: 'Pago pendiente',
    mensaje:
      'Tu pago sigue en proceso. Te llevamos al seguimiento de tu orden para ver el estado en vivo.',
    color: '#F5A623',
    emoji: '⏳',
  },
  desconocido: {
    titulo: 'No pudimos confirmar el estado',
    mensaje:
      'No pudimos leer el estado real de tu compra. Revisá "Mis compras" o intentá de nuevo.',
    color: '#757575',
    emoji: '⚠️',
  },
};

function textoUnico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

// Deriva el resultado del pago de la compra real. `pago` es la fuente de verdad;
// si la compra es antigua y no trae pago, el estado de la compra da una señal
// conservadora (nunca afirmamos un aprobado que el backend no dijo).
function resultadoDeCompra(compra: Compra | null): Resultado {
  if (!compra) return 'desconocido';

  const pago = compra.pago ?? null;
  if (pago) {
    if (pago.estado === 'aprobado') return 'aprobado';
    if (pago.estado === 'rechazado') return 'rechazado';
    if (pago.estado === 'pendiente') return 'pendiente';
  }

  if (compra.estado === 'pagado') return 'aprobado';
  if (compra.estado === 'cancelado') return 'rechazado';
  return 'pendiente';
}

export default function ResultadoPagoScreen() {
  const params = useLocalSearchParams<{
    compraId?: string;
    pagoId?: string;
    paymentId?: string;
  }>();

  const compraId = textoUnico(params.compraId) ?? '';
  const pagoId = textoUnico(params.pagoId) ?? textoUnico(params.paymentId) ?? '';

  const [compra, setCompra] = useState<Compra | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    if (!compraId) {
      setCompra(null);
      setError('No hay una compra asociada a este pago.');
      setCargando(false);
      return;
    }

    setCargando(true);
    setError(null);
    try {
      // INT4-130: el pago existente se consulta PRIMERO. Su estado manda por
      // encima del pago embebido en la compra; la compra se lee después para
      // saber a qué orden/seguimiento navegar.
      let estadoDelPago: EstadoPago | null = null;
      try {
        const pago = await consultarPago(compraId);
        estadoDelPago = pago.estado;
      } catch (thrown) {
        const apiError = toApiError(thrown as AxiosError<ApiProblem>);
        if (apiError.status !== 404) {
          console.warn('[ResultadoPago] No se pudo consultar /pago:', apiError.message);
        }
      }

      const actual = await obtenerCompra(compraId);
      setCompra(actual);

      // Navegación por estado REAL, no por el params con el que se abrió la
      // pantalla. replace para que volver atrás no reabra el checkout.
      const resultado = estadoDelPago ?? resultadoDeCompra(actual);
      if (resultado === 'aprobado') {
        router.replace({
          pathname: '/(cliente)/qr-retiro',
          params: { compraId },
        });
      } else if (resultado === 'pendiente') {
        const ordenId = actual.ordenes.find((orden) => orden.estado !== 'cancelado')?.ordenId;
        router.replace({
          pathname: '/(cliente)/seguimientos',
          params: ordenId ? { compraId, ordenId } : { compraId },
        });
      }
    } catch (thrown) {
      const apiError = toApiError(thrown as AxiosError<ApiProblem>);
      console.error('[ResultadoPago] No se pudo consultar la compra:', apiError.message);
      setCompra(null);
      setError(apiError.message);
    } finally {
      setCargando(false);
    }
  }, [compraId]);

  useFocusEffect(
    useCallback(() => {
      void recargar();
    }, [recargar])
  );

  const estado = resultadoDeCompra(compra);
  const contenido = CONTENIDO_POR_ESTADO[estado];

  if (cargando) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator size="large" color="#0052CC" testID="resultado-cargando" />
        <Text style={styles.mensaje}>Consultando el estado real de tu pago…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.contenido} showsVerticalScrollIndicator={false}>
        <Text style={styles.emoji}>{contenido.emoji}</Text>
        <Text style={[styles.titulo, { color: contenido.color }]} testID="resultado-titulo">
          {contenido.titulo}
        </Text>
        <Text style={styles.mensaje} testID="resultado-mensaje">
          {error ?? contenido.mensaje}
        </Text>

        {!!compra && (
          <Text style={styles.detalle} testID="resultado-compra">
            Compra: {compra.compraId}
          </Text>
        )}
        {!!pagoId && (
          <Text style={styles.detalle} testID="resultado-pago">
            Pago: {pagoId}
          </Text>
        )}

        <View style={styles.acciones}>
          {estado === 'rechazado' && (
            <Presionable
              style={[styles.boton, { backgroundColor: contenido.color }]}
              onPress={() => router.replace('/carrito')}
              testID="resultado-ir-carrito"
            >
              <Text style={styles.botonTexto}>Volver al carrito</Text>
            </Presionable>
          )}

          {estado === 'aprobado' && (
            <Presionable
              style={[styles.boton, { backgroundColor: contenido.color }]}
              onPress={() =>
                router.replace({
                  pathname: '/(cliente)/qr-retiro',
                  params: { compraId },
                })
              }
              testID="resultado-ir-qr"
            >
              <Text style={styles.botonTexto}>Ver código de retiro</Text>
            </Presionable>
          )}

          {estado === 'pendiente' && (
            <Presionable
              style={[styles.boton, { backgroundColor: contenido.color }]}
              onPress={() =>
                router.replace({
                  pathname: '/(cliente)/seguimientos',
                  params: { compraId },
                })
              }
              testID="resultado-ir-seguimiento"
            >
              <Text style={styles.botonTexto}>Ver orden en vivo</Text>
            </Presionable>
          )}

          {estado === 'desconocido' && (
            <Presionable
              style={[styles.boton, { backgroundColor: contenido.color }]}
              onPress={() => void recargar()}
              testID="resultado-reintentar"
            >
              <Text style={styles.botonTexto}>Reintentar consulta</Text>
            </Presionable>
          )}

          <Presionable
            style={[styles.boton, styles.botonSecundario]}
            onPress={() => router.replace('/mis-compras')}
            testID="resultado-ir-compras"
          >
            <Text style={[styles.botonTexto, styles.botonSecundarioTexto]}>Ver mis compras</Text>
          </Presionable>

          <Presionable
            style={[styles.boton, styles.botonSecundario]}
            onPress={() => router.replace('/')}
            testID="resultado-ir-catalogo"
          >
            <Text style={[styles.botonTexto, styles.botonSecundarioTexto]}>Volver al catálogo</Text>
          </Presionable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contenido: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  titulo: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  mensaje: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  detalle: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  acciones: {
    width: '100%',
    marginTop: 32,
    gap: 12,
  },
  boton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  botonSecundario: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#ccc',
  },
  botonTexto: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  botonSecundarioTexto: {
    color: '#333',
  },
});
