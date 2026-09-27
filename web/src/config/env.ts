export const env = {
  appTitle: import.meta.env.VITE_APP_TITLE || 'CloudCoffee',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
} as const;
