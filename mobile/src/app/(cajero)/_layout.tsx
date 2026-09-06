// src/app/(cajero)/_layout.tsx
import { Tabs } from 'expo-router';

export default function CajeroLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Pedidos' }} />
      <Tabs.Screen name="escaner" options={{ title: 'Escanear QR' }} />
      <Tabs.Screen name="stock" options={{ title: 'Stock' }} />
      <Tabs.Screen name="no-retirados" options={{ title: 'No Retirados' }} />
    </Tabs>
  );
}
