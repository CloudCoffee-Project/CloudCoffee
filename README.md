# CloudCoffee

Plataforma de ventas online para las cafeterías de la Universidad Católica de Temuco.

## Entorno backend local

El backend utiliza Docker Compose para ejecutar los microservicios y su infraestructura local.

### Requisitos

- Docker Engine
- Docker Compose v2
- OpenSSL
- curl
- GNU coreutils (`timeout`)

Verificar la instalación:

```bash
docker --version
docker compose version
```

### Preparación inicial

Desde un checkout limpio, preparar las variables locales y la pareja de llaves JWT:

```bash
./scripts/setup-dev-environment.sh
```

El script copia `.env.example` solamente cuando `.env` no existe, genera las llaves
RSA que falten dentro de `secrets/` y comprueba la configuración de Compose. Nunca
sobrescribe un `.env` existente ni una pareja de llaves completa.

`.env.example` contiene valores exclusivamente locales. Tanto `.env` como
`secrets/` son privados y están excluidos de Git.

Cada integrante puede modificar en su `.env` los puertos o credenciales locales sin afectar al resto del equipo.

Si ya existe un `.env` antiguo y la validación informa una variable faltante, copiar
solo esa variable desde `.env.example`; no reemplazar el archivo completo. Compose
entrega la llave privada únicamente a Auth y la pública a los servicios que validan
tokens. La generación manual se explica en
[JWT RS256 del backend](backend/README.md#jwt-rs256-int2-14).

### Iniciar el entorno

```bash
docker compose up --build -d
```

Este comando inicia PostgreSQL, RabbitMQ, Zipkin, los cuatro microservicios, el API
Gateway y la web de Vite. La aplicación queda disponible en
http://localhost:3000 y todas sus peticiones pasan por el Gateway publicado en
http://localhost:18080.

El directorio `web/` se monta en el contenedor para aplicar cambios durante el
desarrollo. Si cambia `package.json` o `package-lock.json`, reconstruir la imagen y
su volumen de dependencias:

```bash
docker compose build web
docker compose run --rm --no-deps web npm ci
docker compose up -d web
```

### Migraciones y datos de desarrollo

Los servicios ejecutan automáticamente sus migraciones Flyway al arrancar. Los
perfiles `docker,dev` definidos en `.env.example` agregan seeds repetibles para:

- cuentas y personal de prueba en Auth;
- campus, cafeterías, categorías, productos y ofertas en Catalog;
- compras y pagos de ejemplo en Order.

Los seeds están separados de `db/migration`, por lo que no se cargan al usar solo
el perfil `docker`. Para reiniciar completamente migraciones y datos locales se
pueden eliminar los volúmenes con `docker compose down --volumes`; esta operación
es destructiva.

### Consultar el estado

```bash
docker compose ps
```

Los cinco procesos Spring Boot y la web se consideran listos únicamente cuando
sus healthchecks responden correctamente. El API Gateway espera a Auth,
Catalog, Order y Notification; la web espera al Gateway.

Comprobación mínima del entorno integrado:

```bash
curl --fail http://localhost:18080/actuator/health
curl --fail http://localhost:18080/v1/catalog/campus
curl --fail http://localhost:3000/
```

### Smoke test automatizado

Después de preparar `.env`, se puede construir, iniciar y comprobar todo el entorno
con un solo comando:

```bash
./scripts/smoke-compose.sh
```

El script aplica un timeout explícito y verifica:

- los healthchecks de infraestructura, bases de datos, microservicios, Gateway y web;
- `GET /actuator/health` del API Gateway;
- `GET /v1/catalog/campus` sin token ni cuenta de prueba;
- la aplicación web servida por Vite.

Si los contenedores ya están iniciados, se puede omitir la construcción y el arranque:

```bash
./scripts/smoke-compose.sh --check-only
```

El timeout y el intervalo de consulta son configurables. Las URL se obtienen desde
los puertos publicados por Compose, aunque también pueden sobrescribirse para una
comprobación puntual:

```bash
SMOKE_TIMEOUT_SECONDS=120 \
SMOKE_POLL_SECONDS=1 \
./scripts/smoke-compose.sh
```

El proceso termina con código `0` únicamente cuando todas las comprobaciones pasan;
usa código `1` ante un fallo de arranque, healthcheck, routing o contenido, y código
`2` ante argumentos, variables o herramientas inválidas. Al fallar muestra
`docker compose ps` y deja los contenedores disponibles para diagnóstico. No elimina
volúmenes, no crea cuentas y no utiliza credenciales reales ni endpoints privados.

Para consultar manualmente salud e información no sensible, sustituir el puerto
por el del servicio correspondiente:

```bash
curl http://localhost:18081/actuator/health
curl http://localhost:18081/actuator/info
```

Solo se exponen `health` e `info`. La respuesta de salud pública muestra el estado
general, pero no los componentes internos ni credenciales.

### Ver los logs

Todos los servicios:

```bash
docker compose logs -f
```

Un servicio específico:

```bash
docker compose logs -f auth-service
```

### Correo local con Mailpit

El entorno de desarrollo usa Mailpit para capturar correos sin conectarse a un
servidor SMTP real. Notification entrega internamente a `mailpit:1025` sin
autenticación ni STARTTLS y la bandeja se consulta únicamente desde el computador
en http://localhost:8025.

Las direcciones incluidas en los mensajes se configuran en `.env`:

```dotenv
FRONTEND_URL=http://localhost:3000
RESET_PASSWORD_URL=http://localhost:3000/restablecer-contrasena
SMTP_FROM=noreply@cloudcoffee.local
```

`FRONTEND_URL` es la base del enlace `/verificar-correo`; la recuperación usa
directamente `RESET_PASSWORD_URL`. Así las rutas pueden cambiar cuando la web
implemente sus pantallas sin modificar Notification.

Para generar y revisar un correo de recuperación usando la cuenta seed:

```bash
curl --fail --request POST \
  http://localhost:18080/v1/auth/password/recovery \
  --header 'Content-Type: application/json' \
  --data '{"email":"comprador@cloudcoffee.dev"}'
```

La API responde `202`. El mensaje y su enlace aparecen en Mailpit; ningún correo
sale a Internet. Los mensajes se conservan en el volumen local `mailpit_data`.

Para reproducir una caída SMTP y observar el reintento:

```bash
docker compose stop mailpit
# Repetir la solicitud anterior.
docker compose logs -f notification-service
docker compose start mailpit
```

Mientras Mailpit está detenido, el healthcheck de correo informa el fallo y el
consumidor aplica su política RabbitMQ de reintentos. Al restaurarlo antes de agotar
los intentos, el correo se entrega; si se agotan, el mensaje sigue la política DLQ
documentada para Notification.

### Trazabilidad distribuida con Zipkin

Micrometer genera y propaga trazas automáticamente en las solicitudes HTTP. Auth y
Notification también propagan el contexto al publicar y consumir mensajes RabbitMQ.
Los logs incluyen el identificador de traza y de span para correlacionarlos con Zipkin.

En el entorno local se exporta el 100 % de las trazas. La proporción puede ajustarse
entre 0.0 y 1.0 en `.env`:

```dotenv
TRACING_SAMPLING_PROBABILITY=1.0
```

Para comprobar la integración:

1. Iniciar el backend con `docker compose up --build -d`.
2. Generar tráfico, por ejemplo con
   `curl http://localhost:18080/v1/catalog/campus`.
3. Abrir [Zipkin](http://localhost:9411), seleccionar un servicio y ejecutar
   **Run Query**. Una petición al catálogo a través del Gateway debe mostrar spans
   de `api-gateway` y `catalog-service` dentro de la misma traza.

Dentro de Docker los servicios exportan a `http://zipkin:9411/api/v2/spans`.
Al ejecutarlos sin Docker se usa `http://localhost:9411/api/v2/spans`, configurable
mediante `ZIPKIN_ENDPOINT`.

### Detener el entorno

Conservar los datos locales:

```bash
docker compose down
```

Eliminar contenedores y datos persistentes:

```bash
docker compose down --volumes
```

El último comando elimina las bases de datos locales y debe utilizarse con precaución.

## Contrato de API para web y mobile

Para el Sprint 2, consultar el
[contrato de compra, pago simulado y retiro (INT2-50)](backend/docs/compra-pago-retiro.md).
Incluye OpenAPI y ejemplos de eventos como referencia para las implementaciones
de backend y clientes.

La [guía de OpenAPI y Swagger del backend](backend/README.md#openapi-y-swagger--api-sprint-1-int2-31)
explica cómo habilitar la documentación con `OPENAPI_ENABLED=true`, consultar
Auth/Catálogo desde Gateway y probar operaciones con JWT. Está desactivada por defecto.
Con Docker Compose, Swagger se abre en http://localhost:18080/swagger-ui.html;
al ejecutar Gateway directamente con su TLS predeterminado, usar HTTPS.

## Servicios

| Componente | Acceso desde el computador |
| --- | --- |
| Web | http://localhost:3000 |
| API Gateway | http://localhost:18080 |
| Auth Service | http://localhost:18081 |
| Catalog Service | http://localhost:18082 |
| Order Service | http://localhost:18083 |
| Notification Service | http://localhost:18084 |
| Mailpit SMTP | localhost:1025 |
| Mailpit Web | http://localhost:8025 |
| Auth PostgreSQL | localhost:15432 |
| Catalog PostgreSQL | localhost:15433 |
| Order PostgreSQL | localhost:15434 |
| Notification PostgreSQL | localhost:15435 |
| RabbitMQ | localhost:5672 |
| RabbitMQ Management | http://localhost:15672 |
| Zipkin | http://localhost:9411 |

Los puertos publicados pueden personalizarse en `.env`.

## Comunicación interna

Los contenedores se comunican mediante nombres internos de Docker:

- `auth-service` → `auth-db:5432`
- `catalog-service` → `catalog-db:5432`
- `order-service` → `order-db:5432`
- `notification-service` → `notification-db:5432`
- `notification-service` → `mailpit:1025`
- `api-gateway` → nombres internos de los microservicios

La documentación técnica se encuentra en `docs/infraestructura-docker.md`.

## Mensajería asíncrona

La topología de RabbitMQ, la política de reintentos, las Dead Letter Queues y la convención de eventos se documentan en [`docs/mensajeria-rabbitmq.md`](docs/mensajeria-rabbitmq.md).
