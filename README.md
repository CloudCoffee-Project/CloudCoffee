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

### Iniciar el entorno

```bash
docker compose up --build -d
```

### Consultar el estado

```bash
docker compose ps
```

### Ver los logs

Todos los servicios:

```bash
docker compose logs -f
```

Un servicio específico:

```bash
docker compose logs -f auth-service
```

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