// src/app/(cliente)/producto/[id].tsx
//
// Ruta dinámica: /(cliente)/producto/123 -> params.id = "123"
import { useLocalSearchParams } from 'expo-router';
import PantallaPlaceholder from '../../../components/PantallaPlaceholder';

export default function DetalleProductoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PantallaPlaceholder titulo={`Detalle de Producto (${id})`} />;
}
