// src/config/soporte.ts
//
// Contacto de soporte de la app (INT4-96). El correo del administrador se
// centraliza acá para que la pantalla "cajero sin cafetería asignada" pueda
// ofrecer la acción "avisar al administrador" sin hardcodear la dirección en la
// UI. Se puede sobreescribir por entorno con EXPO_PUBLIC_ADMIN_EMAIL.

export const ADMIN_EMAIL = process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? 'administrador@cloudcoffee.dev';
