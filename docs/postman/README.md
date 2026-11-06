# Colección Postman de CloudCoffee

Esta colección reproduce los flujos de Auth y Catálogo mediante API Gateway sin
construir cada solicitud manualmente. No contiene credenciales reales.

## Uso

1. Ejecutar `docker compose up -d` y comprobar con `docker compose ps` que los
   servicios estén saludables.
2. Importar los dos archivos JSON de este directorio y seleccionar el environment
   **CloudCoffee local**.
3. Ejecutar **Autenticación** en orden. Después del registro o reenvío, abrir Mailpit
   en <http://localhost:8025>, copiar el token recibido y guardarlo en
   `verificationToken` antes de ejecutar **Verificar correo**.
4. El login guarda `accessToken` y `refreshToken`; refresh reemplaza ambos. Las
   solicitudes protegidas construyen automáticamente el encabezado Bearer.
5. Ejecutar **Catálogo** en orden. Los scripts guardan `campusId`, `cafeteriaId`,
   `categoryId` y `productId` usando los primeros resultados disponibles.

El registro devuelve `409` al repetir el mismo correo; cambia `testEmail` para una
nueva ejecución. Los filtros opcionales `categoriaId` y `q` están desactivados en
**Buscar productos** y pueden habilitarse desde Postman.

No exportes y versiones el environment después de usarlo: contendrá tokens reales
de tu sesión. El archivo del repositorio mantiene vacíos todos esos valores.
