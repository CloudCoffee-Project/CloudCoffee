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
