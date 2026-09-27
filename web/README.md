# CloudCoffee Web

Base de la aplicación web con React 18, TypeScript, Vite y React Router.

## Requisitos

- Node.js 20.19+ o 22.12+
- npm

## Desarrollo

```bash
cd web
npm ci
cp .env.example .env
npm run dev
```

La aplicación se abre en `http://localhost:3000`. El puerto es fijo porque el API Gateway local permite ese origen en CORS. Si el puerto está ocupado, Vite informa el error en lugar de cambiarlo.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `VITE_APP_TITLE` | Título mostrado en la página de inicio; si se omite, se usa `CloudCoffee`. |
| `VITE_API_BASE_URL` | Origen público del API Gateway para el futuro cliente HTTP. En desarrollo: `http://localhost:18080`. |

Copiar `.env.example` a `.env` y ajustar sus valores locales. Vite lee las variables al iniciar el servidor o al compilar; reiniciar tras cambiarlas. Las variables `VITE_*` se incorporan al código del navegador: nunca colocar contraseñas, tokens ni otros secretos aquí. `VITE_API_BASE_URL` se lee en `src/config/env.ts`, pero las peticiones HTTP se implementarán en INT2-41.

## Scripts

```bash
npm run dev        # servidor de desarrollo
npm run typecheck  # revisión de tipos
npm run build      # revisión de tipos y compilación de producción en dist/
npm run preview    # vista local de la compilación
```

## Estructura

- `src/pages/`: páginas asociadas a rutas; inicialmente `/` y `/catalogo`.
- `src/components/`: componentes reutilizables.
- `src/services/`: acceso a servicios externos; el cliente HTTP corresponde a INT2-41.
- `src/hooks/`: hooks reutilizables.
- `src/utils/`: funciones de apoyo.
- `src/config/`: lectura centralizada de configuración pública.
- `src/App.tsx`: definición de rutas. El layout y la navegación visual corresponden a INT2-42.

Para publicar la aplicación como SPA, el servidor que entregue `dist/` debe responder con `index.html` en rutas de la aplicación como `/catalogo`.
