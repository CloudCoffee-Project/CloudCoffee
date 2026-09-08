// src/app/(cliente)/carrito.tsx
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { abrirCheckoutMercadoPago } from '../../services/pagos';

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
      const initPointDePrueba = 'https://www.mercadopago.cl';

      const resultado = await abrirCheckoutMercadoPago(initPointDePrueba);

      if (resultado.tipo === 'cerrado_sin_confirmar') {
        console.log('[Carrito] El usuario cerró el checkout sin confirmar');
      }
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
      <Text style={styles.nota}>
        (Armado del carrito pendiente de implementación — otra tarea)
      </Text>

      <Pressable
        style={[styles.boton, procesando && styles.botonDeshabilitado]}
        onPress={handlePagar}
        disabled={procesando}
      >
        <Text style={styles.botonTexto}>
          {procesando ? 'Abriendo...' : 'Pagar'}
        </Text>
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