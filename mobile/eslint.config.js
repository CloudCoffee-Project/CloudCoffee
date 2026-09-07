// eslint.config.js
//
// Expo ya trae "expo lint" (script en package.json) que usa una config
// base razonable. Este archivo la extiende con reglas propias del equipo.
//
// IMPORTANTE: en ESLint 9 (flat config), cada objeto de configuración debe
// declarar explícitamente los plugins que usa en SUS reglas, aunque ese
// plugin ya venga cargado en otro objeto anterior del array (como
// expoConfig). Por eso se importa '@typescript-eslint/eslint-plugin' acá
// y se registra en el bloque "plugins" de este mismo objeto -- si no,
// ESLint no logra resolver "@typescript-eslint/no-unused-vars" al correr
// sobre un archivo suelto (como hace lint-staged), aunque sí funcione al
// correr "eslint" sobre el proyecto completo.
//
// 'no-unused-vars' (variante TS) queda en 'error' a propósito: lint-staged
// + husky solo bloquean el commit si eslint termina con código de salida
// distinto de cero, y eso solo pasa con errores, no con warnings.

const expoConfig = require('eslint-config-expo/flat');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [
  ...expoConfig,
  {
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      quotes: ['warn', 'single', { avoidEscape: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**'],
  },
];
