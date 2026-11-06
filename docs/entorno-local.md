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

## 3. Reinicio y recuperación segura

Aplicar la alternativa menos destructiva que resuelva el problema:

### Reiniciar un proceso

```bash
docker compose restart catalog-service
docker compose ps catalog-service
docker compose logs --tail=100 catalog-service
```

### Recrear un contenedor tras cambiar `.env`

```bash
docker compose up -d --force-recreate catalog-service
```

### Reconstruir después de cambiar código o dependencias

```bash
docker compose up --build -d catalog-service
```

Si cambió `web/package.json` o `web/package-lock.json`:

```bash
docker compose build web
docker compose run --rm --no-deps web npm ci
docker compose up -d web
```

### Detener conservando datos

```bash
docker compose down
docker compose up -d
```

### Recuperar una base de desarrollo incompatible

Primero revisar la migración que falla:

```bash
docker compose logs --tail=200 catalog-service
```

Solo cuando sea aceptable perder **todas** las bases, mensajes y correos locales:

```bash
docker compose down --volumes
docker compose up --build -d
```

`--volumes` es destructivo y no es necesario para cambios normales de código.
Nunca debe ejecutarse contra un entorno compartido.

### Fallos frecuentes

| Síntoma | Diagnóstico | Recuperación |
| --- | --- | --- |
| Puerto ocupado | `docker compose ps` y `ss -ltnp` | Cambiar el puerto publicado en `.env` y recrear el servicio |
| Variable vacía | `docker compose config` | Agregar únicamente la variable faltante desde `.env.example` |
| Servicio `unhealthy` | `docker compose logs --tail=200 SERVICIO` | Resolver la dependencia y recrear solo ese servicio |
| JWT no inicia | Revisar logs y archivos de `secrets/` | Ejecutar `setup-dev-environment.sh` sin reemplazar llaves válidas |
| Web sin dependencias | Logs de `web` | Reinstalar el volumen de npm con los comandos anteriores |
| Migración Flyway falla | Logs del microservicio y nombre de migración | Corregir la migración; reiniciar volúmenes solo si los datos son descartables |

## 4. Diagnóstico por `traceId`

Para reproducir una petición HTTP con un identificador conocido, enviar cabeceras
B3 válidas. El trace tiene 32 caracteres hexadecimales y el span 16:

```bash
TRACE_ID=$(openssl rand -hex 16)
SPAN_ID=$(openssl rand -hex 8)
curl --fail http://localhost:18080/v1/catalog/campus \
  -H "X-B3-TraceId: $TRACE_ID" \
  -H "X-B3-SpanId: $SPAN_ID" \
  -H 'X-B3-Sampled: 1'
echo "$TRACE_ID"
```

Consultar el valor impreso directamente en la API de Zipkin:

```bash
curl --fail "http://localhost:9411/api/v2/trace/$TRACE_ID"
```

También puede pegarse en **Trace ID** de <http://localhost:9411> para consultar la
traza completa. Con muestreo `1.0`, la solicitud anterior debe mostrar spans de
Gateway y Catalog. Una solicitud exitosa no siempre genera una línea de aplicación;
si la operación sí registra actividad o falla, los logs también pueden filtrarse:

```bash
docker compose logs api-gateway catalog-service | grep "$TRACE_ID"
```

`X-Trace-Id` tiene otro propósito: Auth lo incorpora a eventos de registro,
verificación y recuperación para correlacionarlos a través de RabbitMQ. No reemplaza
las cabeceras B3 de trazabilidad HTTP. Para seguir un evento:

```bash
EVENT_TRACE=demo-correo-001
curl --fail --request POST http://localhost:18080/v1/auth/password/recovery \
  --header 'Content-Type: application/json' \
  --header "X-Trace-Id: $EVENT_TRACE" \
  --data '{"email":"comprador@cloudcoffee.dev"}'
docker compose logs auth-service notification-service | grep "$EVENT_TRACE"
```

Ante un error de dominio, revisar además la propiedad `traceId` de la respuesta
`application/problem+json` y buscarla de la misma manera.

## 5. Verificación de esta guía

El procedimiento se verificó el 6 de noviembre de 2026 ejecutando:

```bash
./scripts/setup-dev-environment.sh
./scripts/smoke-compose.sh --check-only
```

La preparación conservó el `.env` existente y validó Compose. El smoke confirmó
healthchecks de infraestructura, cuatro bases, cuatro microservicios, Gateway y web;
además comprobó salud del Gateway, catálogo público y aplicación web. Finalizó con
código `0` y `Smoke HTTP completado correctamente`.
