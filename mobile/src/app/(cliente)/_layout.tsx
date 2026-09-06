// src/app/(cliente)/_layout.tsx
//
// Tabs del rol cliente. Mapeadas a las issues del Sprint 1:
//   index (Catálogo)     -> INT4-26 a INT4-31
//   carrito               -> INT4-32 a INT4-37
//   mis-compras            -> INT4-50
//   perfil                 -> INT4-23, INT4-24
// "seguimientos" y "notificaciones" quedan como rutas internas navegables
// desde Perfil, no como tabs propias (evita saturar la barra inferior).

import { Tabs } from 'expo-router';

export default function ClienteLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Catálogo' }} />
      <Tabs.Screen name="carrito" options={{ title: 'Carrito' }} />
      <Tabs.Screen name="mis-compras" options={{ title: 'Mis Compras' }} />
      <Tabs.Screen name="perfil" options={{ title: 'Perfil' }} />
    </Tabs>
  );
}
