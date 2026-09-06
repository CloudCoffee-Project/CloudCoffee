// src/app/(auth)/_layout.tsx
//
// Stack de autenticación: login, registro, verificación de correo,
// recuperación/reset de contraseña, activación de cuenta (cajero).
// Todas estas pantallas son públicas (no requieren sesión).

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="registro" />
      <Stack.Screen name="verificar-correo" />
      <Stack.Screen name="olvidaste-contrasena" />
      <Stack.Screen name="restaurar-contrasena" />
      <Stack.Screen name="activar-cuenta" />
    </Stack>
  );
}
