// src/app/(cajero)/index.tsx
import { useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { fetchPedidosEntrantes, Orden } from '../../services/ordenes';
import { useOrdenEstado } from '../../hooks/useOrdenEstado';

function FilaPedido({ orden }: { orden: Orden }) {
  const estadoEnVivo = useOrdenEstado(orden.id);
  const estadoMostrado = estadoEnVivo ?? orden.estado;

  return (
    <View style={styles.fila}>
      <Text style={styles.codigo}>{orden.codigoOrden}</Text>
      <Text style={styles.estado}>{estadoMostrado}</Text>
    </View>
  );
}

export default function PedidosEntrantesScreen() {
  const [pedidos, setPedidos] = useState<Orden[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargarPedidos() {
    try {
      // TODO: reemplazar por el accessToken real una vez conectado el login
      const data = await fetchPedidosEntrantes('token_de_prueba');
      setPedidos(data);
      setError(null);
    } catch {
      setError('No se pudieron cargar los pedidos. Verifica tu conexión.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch inicial de datos, patrón válido
    void cargarPedidos();
  }, []);

  if (cargando) {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.contenedor}>
      <Text style={styles.titulo}>Pedidos Entrantes</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={pedidos}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <FilaPedido orden={item} />}
        refreshControl={<RefreshControl refreshing={cargando} onRefresh={cargarPedidos} />}
        ListEmptyComponent={
          !error ? <Text style={styles.vacio}>No hay pedidos pendientes por ahora.</Text> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1, padding: 16 },
  centrado: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  titulo: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  fila: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  codigo: { fontWeight: '600' },
  estado: { color: '#555' },
  error: { color: 'red', marginBottom: 8 },
  vacio: { textAlign: 'center', marginTop: 40, color: '#888' },
});
