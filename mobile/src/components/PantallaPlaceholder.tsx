// src/components/PantallaPlaceholder.tsx
//
// Placeholder genérico para pantallas cuya navegación ya existe (INT4-14)
// pero cuya lógica/UI real se implementa en issues posteriores.

import { View, Text, StyleSheet } from 'react-native';

interface Props {
  titulo: string;
}

export default function PantallaPlaceholder({ titulo }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>{titulo}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  titulo: { fontSize: 20, fontWeight: 'bold' },
});
