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
| `VITE_API_BASE_URL` | Origen público del API Gateway, sin ruta ni parámetros. En desarrollo: `http://localhost:18080`. |

Copiar `.env.example` a `.env` y ajustar sus valores locales. Vite lee las variables al iniciar el servidor o al compilar; reiniciar tras cambiarlas. Las variables `VITE_*` se incorporan al código del navegador: nunca colocar contraseñas, tokens ni otros secretos aquí. Al usar el cliente HTTP, `VITE_API_BASE_URL` debe estar configurada; no se usa una URL de respaldo.

## Cliente HTTP

Usar `request<T>` desde `src/services/httpClient.ts` para las peticiones al Gateway. La ruta debe comenzar con `/v1/` y permanecer allí tras normalizarse. El cliente agrega `Accept: application/json` si no se especifica otro valor y conserva los headers enviados por cada petición, incluido `Authorization` para futuras tareas de autenticación. El cuerpo y su `Content-Type` se pasan mediante las opciones estándar de `fetch`.

```ts
import { request } from './services/httpClient';

async function login(email: string, password: string) {
  return request<{ accessToken: string; refreshToken: string }>('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}
```

La respuesta JSON se entrega como el tipo solicitado. Una respuesta sin contenido devuelve `undefined`. Los errores HTTP y de conexión se entregan como `ApiRequestError`: `status` es el código HTTP o `null` cuando falla la conexión; `title` y `detail` son mensajes seguros para la UI. Si el Gateway responde con Problem Details, también quedan disponibles `type`, `instance` y `errors` de validación. Las cancelaciones con `AbortError` se propagan para que quien hizo la petición pueda ignorarlas.

### Verificación local con el Gateway

1. Iniciar los servicios desde la raíz con `docker compose up --build -d` y la web con `npm run dev`. Docker Compose sirve el Gateway local por HTTP en `http://localhost:18080`; la configuración predeterminada del Gateway conserva HTTPS.
2. Abrir `http://localhost:3000` y ejecutar esto en la consola del navegador:

```js
const { request, ApiRequestError } = await import('/src/services/httpClient.ts');
try {
  await request('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
} catch (error) {
  if (!(error instanceof ApiRequestError)) throw error;
  console.log(error.status, error.title, error.detail, error.errors);
}
```

La petición debe ir a `http://localhost:18080/v1/auth/login` y devolver `400` con el detalle y los campos inválidos del Problem Details. En la pestaña Red del navegador debe observarse una respuesta legible desde `http://localhost:3000`, lo que confirma CORS. No se necesitan credenciales reales para esta comprobación.

## Scripts

```bash
npm run dev        # servidor de desarrollo
npm run typecheck  # revisión de tipos
npm test           # pruebas del cliente HTTP
npm run build      # revisión de tipos y compilación de producción en dist/
npm run preview    # vista local de la compilación
```

## Estructura

- `src/pages/`: páginas asociadas a rutas; inicialmente `/` y `/catalogo`.
- `src/components/`: componentes reutilizables.
- `src/services/`: cliente HTTP común para acceder al API Gateway.
- `src/hooks/`: hooks reutilizables.
- `src/utils/`: funciones de apoyo.
- `src/config/`: lectura centralizada de configuración pública.
- `src/App.tsx`: definición de rutas. El layout y la navegación visual corresponden a INT2-42.

Para publicar la aplicación como SPA, el servidor que entregue `dist/` debe responder con `index.html` en rutas de la aplicación como `/catalogo`.
