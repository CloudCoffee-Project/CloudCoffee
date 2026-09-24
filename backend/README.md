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
├── common-security/
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
./auth-service/mvnw -f pom.xml -pl common-security -am install
```

```bash
cd auth-service
./mvnw spring-boot:run
```

## JWT RS256 (INT2-14)

Antes de iniciar, generar un par RSA local desde la raíz del repositorio con OpenSSL:

```bash
mkdir secrets
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out secrets/jwt-private.pem
openssl pkey -in secrets/jwt-private.pem -pubout -out secrets/jwt-public.pem
```

La privada usa PEM PKCS#8 (`BEGIN PRIVATE KEY`); la pública usa PEM X.509
(`BEGIN PUBLIC KEY`). `secrets/` queda fuera del contexto de build de Docker y de
Git. Los archivos `.pem` y `.key` también se excluyen de Git y de las imágenes.
En Linux, permitir la lectura al usuario `spring` del contenedor y restringir el
resto de los accesos: Compose con secretos basados en archivos conserva los permisos
del host.
No sobrescribir un par existente: cambiarlo invalida los JWT firmados con él.

Docker Compose monta ambos archivos en Auth mediante `secrets`; Gateway, Catalog,
Order y Notification reciben **únicamente la pública**. Las rutas del host se
configuran con `JWT_PRIVATE_KEY_FILE` y `JWT_PUBLIC_KEY_FILE` en `.env`.
No copiar la privada a imágenes, recursos del classpath ni otros servicios.

Al ejecutar sin Docker, configurar `JWT_PUBLIC_KEY_LOCATION` en cada proceso y
`JWT_PRIVATE_KEY_LOCATION` **solo en Auth**. Usar URLs de archivo absolutas, por
ejemplo `file:/ruta/secrets/jwt-public.pem` o `file:/C:/ruta/secrets/jwt-public.pem`.
El arranque falla si falta la llave pública, es inválida o tiene menos de 2048 bits;
Auth también falla si falta la privada o no corresponde al mismo par.

`JwtTokenService.emitir(Usuario)` firma el identificador persistido (`sub`) y el
rol real del usuario (`role`: `CLIENTE`, `CAJERO`, `ADMIN_CAFETERIA`, `SUPER_ADMIN`),
con fecha de emisión (`iat`) y vencimiento (`exp`). La duración predeterminada es
15 minutos, configurable mediante `cloudcoffee.jwt.access-token-ttl` (por ejemplo
`PT15M`). Este componente es para el futuro flujo de login de INT2-21: **no se
agrega un endpoint de login ni se implementan refresh, revocación o permisos por rol**.
El consumidor debe autenticar y comprobar el estado del usuario antes de emitir.

`common-security` valida la firma RS256, el vencimiento sin tolerancia posterior a
`exp`, `nbf` cuando existe, `sub` no vacío y un `role` reconocido. Convierte el rol
en una autoridad `ROLE_<rol>`. No usa cookies ni sesiones. Gateway valida antes de
reenviar y conserva el Bearer original; cada microservicio vuelve a verificarlo,
incluso cuando se accede directamente a su puerto. Un token ausente en una ruta
protegida o un Bearer inválido devuelve **401** con el contrato RFC 9457 existente.

Se mantienen públicos estos métodos y rutas (anteponer `/v1` al usar Gateway):

| Método | Ruta interna |
| --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/refresh` |
| POST | `/auth/verificacion`, `/auth/verificacion/reenviar` |
| POST | `/auth/password/recovery`, `/auth/password/reset` |
| GET, HEAD | `/catalog/campus`, `/catalog/categorias` |

Los endpoints de monitoreo ya expuestos por Notification (`GET`/`HEAD`
`/actuator/health` y `/actuator/info`) también conservan su acceso público directo;
no se agrega una ruta de Gateway para ellos.

La lista mantiene el contrato previo del Gateway; no crea endpoints que todavía
no estén implementados. Todas las demás rutas de los microservicios requieren JWT,
incluido `/internal/test/events` cuando está habilitado. Los preflight CORS siguen
resolviéndose en Gateway sin JWT. Una petición pública **sin Bearer** es anónima;
si envía un Bearer inválido se rechaza con 401.

Las pruebas generan llaves temporales, sin credenciales versionadas. `clean verify`
comprueba firma y roles emitidos por Auth, rechazo de tokens vencidos, adulterados,
firmados por otra llave o algoritmo, claims obligatorios, acceso directo a cada
servicio, rutas públicas, propagación del token, CORS y los flujos previos del backend.

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
