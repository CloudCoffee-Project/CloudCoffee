# CloudCoffee

Plataforma de ventas online para las cafeterías de la Universidad Católica de Temuco.

## Entorno backend local

El backend utiliza Docker Compose para ejecutar los microservicios y su infraestructura local.

### Requisitos

- Docker Engine
- Docker Compose v2

Verificar la instalación:

```bash
docker --version
docker compose version
```

### Configuración

Crear el archivo local de variables:

```bash
cp .env.example .env
```

`.env.example` contiene valores de desarrollo. El archivo `.env` es privado y está excluido de Git.

Cada integrante puede modificar en su `.env` los puertos o credenciales locales sin afectar al resto del equipo.

Antes del primer arranque, generar las llaves JWT siguiendo la sección
[JWT RS256 del backend](backend/README.md#jwt-rs256-int2-14). Compose entrega la
llave privada solo a Auth y la pública a los servicios que validan tokens.

### Iniciar el entorno

```bash
docker compose up --build -d
```

### Consultar el estado

```bash
docker compose ps
```

Los cinco procesos Spring Boot se consideran listos únicamente cuando su endpoint
`/actuator/health` responde correctamente. El API Gateway espera a que Auth,
Catalog, Order y Notification estén saludables antes de iniciar.

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

La [guía de OpenAPI y Swagger del backend](backend/README.md#openapi-y-swagger--api-sprint-1-int2-31)
explica cómo habilitar la documentación con `OPENAPI_ENABLED=true`, consultar
Auth/Catálogo desde Gateway y probar operaciones con JWT. Está desactivada por defecto.
Con Docker Compose, Swagger se abre en http://localhost:18080/swagger-ui.html;
al ejecutar Gateway directamente con su TLS predeterminado, usar HTTPS.

## Servicios

| Componente | Acceso desde el computador |
| --- | --- |
| API Gateway | http://localhost:18080 |
| Auth Service | http://localhost:18081 |
| Catalog Service | http://localhost:18082 |
| Order Service | http://localhost:18083 |
| Notification Service | http://localhost:18084 |
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
- `api-gateway` → nombres internos de los microservicios

La documentación técnica se encuentra en `docs/infraestructura-docker.md`.

## Mensajería asíncrona

La topología de RabbitMQ, la política de reintentos, las Dead Letter Queues y la convención de eventos se documentan en [`docs/mensajeria-rabbitmq.md`](docs/mensajeria-rabbitmq.md).
