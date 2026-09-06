const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    rules: {
      // Evita imports no usados que quedan de copiar/pegar entre pantallas
      'no-unused-vars': 'warn',
      // Fuerza comillas simples consistentes en todo el proyecto
      quotes: ['warn', 'single', { avoidEscape: true }],
      // Evita console.log olvidados en PRs (permite warn/error para debug real)
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**'],
  },
];
