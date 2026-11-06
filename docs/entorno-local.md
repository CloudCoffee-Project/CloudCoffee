# Arranque limpio y recuperación del entorno local

Esta guía permite reproducir CloudCoffee desde un checkout nuevo y diagnosticar
fallos sin depender de archivos privados de otro integrante.

## 1. Requisitos y variables

Se necesita Docker Engine, Docker Compose v2, OpenSSL, `curl` y GNU `timeout`.

```bash
docker --version
docker compose version
openssl version
curl --version
timeout --version
```

El repositorio versiona `.env.example`, pero nunca `.env` ni `secrets/`. El script
de preparación crea esos archivos locales sin sobrescribir los existentes:

```bash
./scripts/setup-dev-environment.sh
```

Antes de arrancar, comprobar que existen:

```text
.env
secrets/jwt-private.pem
secrets/jwt-public.pem
```

Las variables obligatorias se agrupan así:

| Grupo | Variables |
| --- | --- |
| RabbitMQ | `RABBITMQ_USER`, `RABBITMQ_PASSWORD` |
| PostgreSQL | nombres, usuarios, contraseñas y puertos de Auth, Catalog, Order y Notification |
| Servicios | `AUTH_SERVICE_PORT`, `CATALOG_SERVICE_PORT`, `ORDER_SERVICE_PORT`, `NOTIFICATION_SERVICE_PORT` |
| Acceso público | `API_GATEWAY_PORT`, `WEB_PORT`, `CORS_ALLOWED_ORIGINS` |
| Comunicación interna | `INTERNAL_SERVICE_TOKEN` |
| JWT | `JWT_PUBLIC_KEY_FILE`, `JWT_PRIVATE_KEY_FILE` |
| Desarrollo | perfiles `docker,dev`, Mailpit, URLs del frontend y trazabilidad |

Los valores de `.env.example` son exclusivamente locales. En otros entornos deben
usarse credenciales y llaves propias, y los perfiles no deben incluir `dev`.

## 2. Arranque desde un checkout limpio

```bash
git clone https://github.com/CloudCoffee-Project/CloudCoffee.git
cd CloudCoffee
./scripts/setup-dev-environment.sh
docker compose up --build -d
docker compose ps
```

Esperar hasta que los servicios necesarios aparezcan como `healthy`. Luego ejecutar
la comprobación HTTP reproducible:

```bash
./scripts/smoke-compose.sh --check-only
```

También puede construirse, arrancarse y verificarse todo en un solo paso:

```bash
./scripts/smoke-compose.sh
```

Accesos predeterminados:

| Componente | URL |
| --- | --- |
| Web | <http://localhost:3000> |
| API Gateway | <http://localhost:18080> |
| Mailpit | <http://localhost:8025> |
| RabbitMQ Management | <http://localhost:15672> |
| Zipkin | <http://localhost:9411> |

Los clientes deben usar Gateway y no los puertos internos de los microservicios.
Una verificación manual mínima es:

```bash
curl --fail http://localhost:18080/actuator/health
curl --fail http://localhost:18080/v1/catalog/campus
curl --fail http://localhost:3000/
```
