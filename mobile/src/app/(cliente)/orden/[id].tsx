// src/app/(cliente)/orden/[id].tsx
import { useLocalSearchParams } from 'expo-router';
import PantallaPlaceholder from '../../../components/PantallaPlaceholder';

export default function DetalleOrdenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PantallaPlaceholder titulo={`Orden ${id} (QR/Boleta)`} />;
}
