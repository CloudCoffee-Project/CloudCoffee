// src/app/(cliente)/resultado-pago.tsx
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { EstadoPagoVisual } from '../../services/pagos';

interface ContenidoResultado {
  titulo: string;
  mensaje: string;
  color: string;
  emoji: string;
}

const CONTENIDO_POR_ESTADO: Record<EstadoPagoVisual, ContenidoResultado> = {
  exitoso: {
    titulo: 'Pago exitoso',
    mensaje:
      'Tu pago fue procesado correctamente. Muy pronto vas a poder ver tu código QR de retiro y tu boleta en "Mis compras".',
    color: '#00A650',
    emoji: '✅',
  },
  rechazado: {
    titulo: 'Pago rechazado',
    mensaje:
      'Mercado Pago rechazó el pago. Puedes volver al carrito e intentar nuevamente con otro medio de pago.',
    color: '#D32F2F',
    emoji: '❌',
  },
  pendiente: {
    titulo: 'Pago pendiente',
    mensaje:
      'Tu pago está siendo procesado (por ejemplo, si pagaste en efectivo en un punto de pago). Te avisaremos cuando se confirme.',
    color: '#F5A623',
    emoji: '⏳',
  },
  desconocido: {
    titulo: 'No pudimos confirmar el estado',
    mensaje:
      'Algo no salió como esperábamos al leer el resultado del pago. Revisa "Mis compras" para ver el estado actualizado.',
    color: '#757575',
    emoji: '⚠️',
  },
};

export default function ResultadoPagoScreen() {
  const params = useLocalSearchParams<{
    estado?: string;
    compraId?: string;
    paymentId?: string;
  }>();

  const estado = (params.estado as EstadoPagoVisual) ?? 'desconocido';
  const contenido = CONTENIDO_POR_ESTADO[estado] ?? CONTENIDO_POR_ESTADO.desconocido;

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{contenido.emoji}</Text>

      <Text style={[styles.titulo, { color: contenido.color }]}>{contenido.titulo}</Text>

      <Text style={styles.mensaje}>{contenido.mensaje}</Text>

      {!!params.compraId && <Text style={styles.detalle}>Compra: {params.compraId}</Text>}
      {!!params.paymentId && <Text style={styles.detalle}>Pago: {params.paymentId}</Text>}

      <View style={styles.acciones}>
        <Pressable
          style={[styles.boton, { backgroundColor: contenido.color }]}
          onPress={() => router.replace('/mis-compras')}
        >
          <Text style={styles.botonTexto}>Ver mis compras</Text>
        </Pressable>

        <Pressable
          style={[styles.boton, styles.botonSecundario]}
          onPress={() => router.replace('/')}
        >
          <Text style={[styles.botonTexto, styles.botonSecundarioTexto]}>Volver al catálogo</Text>
        </Pressable>
      </View>
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
