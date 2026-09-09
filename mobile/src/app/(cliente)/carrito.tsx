// src/app/(cliente)/carrito.tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import { abrirCheckoutMercadoPago, parsearRetornoPago } from '../../services/pagos';

export default function CarritoScreen() {
  const [procesando, setProcesando] = useState(false);

  const handlePagar = async () => {
    setProcesando(true);
    try {
      // TODO(INT4-??): reemplazar por los items reales del carrito cuando se
      // implemente el armado de carrito multi-cafetería (fuera del alcance de INT4-38).
      //
      // Flujo real, cuando el backend exista:
      // const { initPoint } = await crearCompra(itemsDelCarrito, accessToken);
      // await abrirCheckoutMercadoPago(initPoint);

      // ⚠️⚠️ MOCK TEMPORAL — SOLO PARA DESARROLLO ⚠️⚠️
      // El backend de Integración II (POST /compras) todavía no existe.
      // Este bloque simula el retorno exitoso de Mercado Pago usando
      // httpbin.org/redirect-to, para poder probar el deep link
      // cloudcoffee://payment/retorno de punta a punta (INT4-38/39).
      //
      // El guard `if (!__DEV__)` evita que esto pueda ejecutarse jamás en
      // un build de producción: si alguien olvida borrar este mock, la app
      // falla explícitamente en vez de abrir httpbin.org a un usuario real.
      // TODO(INT4-??): borrar este bloque completo cuando POST /compras exista.
      if (!__DEV__) {
        throw new Error(
          'Mock de pago sin reemplazar por la llamada real a crearCompra(). ' +
            'No se puede continuar en producción.'
        );
      }

      const initPointDePrueba =
        'https://httpbin.org/redirect-to?url=' +
        encodeURIComponent(
          'cloudcoffee://payment/retorno?status=approved&payment_id=123&external_reference=abc123'
        );
      // ⚠️⚠️ FIN DEL MOCK TEMPORAL ⚠️⚠️

      const resultado = await abrirCheckoutMercadoPago(initPointDePrueba);

      if (resultado.tipo === 'cerrado_sin_confirmar') {
        // El usuario cerró el navegador embebido antes de completar el pago.
        // No navegamos a ningún lado: se queda en el carrito para reintentar.
        console.warn('[Carrito] El usuario cerró el checkout sin confirmar');
        return;
      }

      // Camino A (INT4-39): Mercado Pago redirigió de vuelta con éxito.
      // Parseamos la URL para extraer el estado visual y navegar al resultado.
      const retorno = parsearRetornoPago(resultado.url);
      console.warn('[Carrito] Retorno de pago parseado:', retorno);

      router.replace({
        pathname: '/resultado-pago',
        params: {
          estado: retorno.estado,
          compraId: retorno.compraId ?? '',
          paymentId: retorno.paymentId ?? '',
        },
      });
    } catch (error) {
      console.error('[Carrito] Error al abrir el checkout:', error);
      Alert.alert('Error', 'No se pudo abrir el checkout de Mercado Pago.');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Carrito</Text>
      <Text style={styles.nota}>(Armado del carrito pendiente de implementación — otra tarea)</Text>

      <Pressable
        style={[styles.boton, procesando && styles.botonDeshabilitado]}
        onPress={handlePagar}
        disabled={procesando}
      >
        <Text style={styles.botonTexto}>{procesando ? 'Abriendo...' : 'Pagar'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titulo: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  nota: {
    color: '#888',
    marginBottom: 32,
    textAlign: 'center',
  },
  boton: {
    backgroundColor: '#00A650',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  botonDeshabilitado: {
    opacity: 0.6,
  },
  botonTexto: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
