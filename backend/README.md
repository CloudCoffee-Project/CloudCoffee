# CloudCoffee Backend

Backend de CloudCoffee construido con arquitectura de microservicios.

## Stack

- Java 21 LTS
- Spring Boot 4.0.8
- Maven
- Spring Cloud Gateway
- PostgreSQL 16
- RabbitMQ 3.13
- Docker / Docker Compose

## Estructura

```text
backend/
├── common-errors/
├── api-gateway/
├── auth-service/
├── catalog-service/
├── order-service/
└── notification-service/
```

## Requisitos

- JDK 21
- Maven
- Git
- Docker y Docker Compose

## Compilar y probar

Desde `backend`, compilar todos los servicios y ejecutar las pruebas:

```bash
./auth-service/mvnw -f pom.xml clean verify
```

En PowerShell:

```powershell
.\auth-service\mvnw.cmd -f pom.xml clean verify
```

Para construir un servicio junto con su biblioteca compartida:

```bash
./auth-service/mvnw -f pom.xml -pl auth-service -am clean verify
```

`-pl` selecciona el servicio; `-am` incluye sus dependencias del repositorio.
Cada servicio conserva su proyecto Spring Boot y su JAR ejecutable independiente.
Las pruebas de los servicios con JPA usan H2 en memoria; PostgreSQL continúa siendo
la base de datos de ejecución normal.

## Ejecutar

Antes de ejecutar un servicio por separado, instalar la biblioteca compartida en
el repositorio Maven local (desde `backend`):

```bash
./auth-service/mvnw -f pom.xml -pl common-errors install
```

```bash
cd auth-service
./mvnw spring-boot:run
```

## CORS en API Gateway

El Gateway gestiona CORS para `/v1/**`; los microservicios no necesitan configurar CORS.
Define `CORS_ALLOWED_ORIGINS` con los orígenes exactos del frontend, separados por comas:

```dotenv
# Desarrollo: ajustar el puerto al del frontend.
CORS_ALLOWED_ORIGINS=http://localhost:3000
# Producción: reemplazar por el dominio real del frontend.
# CORS_ALLOWED_ORIGINS=https://app.example.com
```

Docker Compose toma esta variable del archivo `.env`. Al ejecutar el Gateway directamente,
debe estar definida en su entorno. Si está vacía, no se autorizan solicitudes entre orígenes;
los comodines (`*`) impiden el arranque. Cada origen incluye protocolo, host y puerto si aplica,
sin rutas ni barra final.

El Gateway responde los preflight `OPTIONS` sin exigir autenticación ni enviarlos al
microservicio. Permite los métodos `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` y `OPTIONS`,
y los encabezados `Authorization`, `Content-Type` y `Accept`. No habilita cookies entre
orígenes y las rutas protegidas conservan su requisito de autenticación.

## Paquetes

Los servicios utilizan la raíz:

```text
cl.cloudcoffee
```

Ejemplos:

```text
cl.cloudcoffee.auth
cl.cloudcoffee.catalog
cl.cloudcoffee.order
cl.cloudcoffee.notification
cl.cloudcoffee.gateway
```
