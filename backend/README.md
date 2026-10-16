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

## OpenAPI y Swagger · API Sprint 1 (INT2-31)

El backend mantiene el contrato para los equipos web y mobile. SpringDoc 3.1.1
lo genera desde los controladores y DTO de Auth y Catalog; Swagger UI se sirve
solo desde API Gateway, con las definiciones **Auth** y **Catálogo**.
No se necesita modificar las aplicaciones cliente para consultar la documentación.

### Habilitar en desarrollo

La documentación está desactivada por defecto. En el `.env` local, configurar:

```dotenv
OPENAPI_ENABLED=true
```

Desde la raíz del repositorio, reconstruir y recrear los tres procesos:

```bash
docker compose up --build -d auth-service catalog-service api-gateway
```

Compose propaga la variable a los tres servicios. No modificar las llaves JWT ni
borrar volúmenes. Para deshabilitarla, establecer `OPENAPI_ENABLED=false` y recrear
los mismos servicios. Los contratos, las rutas `/openapi/*` y Swagger dejan de
estar disponibles. Order y Notification no incorporan documentación en esta issue.

Al ejecutar sin Docker, definir `OPENAPI_ENABLED=true` en el entorno de **cada**
proceso (Gateway, Auth y Catalog), además de las variables JWT y de infraestructura
habituales. Activarla únicamente en Gateway no habilita los contratos de los servicios.

| Ejecución | Swagger UI (puerto predeterminado del host) |
| --- | --- |
| Docker Compose: Gateway tiene `SERVER_SSL_ENABLED=false` | http://localhost:18080/swagger-ui.html |
| Gateway ejecutado directamente: HTTPS habilitado por defecto | https://localhost:18080/swagger-ui.html |

Si se cambia el puerto publicado o el protocolo, usar el mismo origen del Gateway.
El servidor OpenAPI es relativo (`/v1`): “Try it out” usa automáticamente ese
protocolo, host y puerto, sin enviar solicitudes a los puertos internos.

### Consultar y probar

1. Abrir Swagger y elegir **Auth** o **Catálogo** en “Select a definition”.
2. Expandir una operación para consultar parámetros, ejemplos, validaciones,
   respuestas y códigos de error. Todos los ejemplos son ficticios.
3. Para operaciones protegidas, iniciar sesión con una cuenta local verificada,
   copiar `accessToken` y pulsar **Authorize** en la definición elegida. Pegar solo
   el token, sin el prefijo `Bearer`; Swagger genera el encabezado.
4. Pulsar **Try it out** y **Execute**. Estas solicitudes ejecutan operaciones
   reales en el backend de desarrollo y consumen las cuotas del Gateway.

Los contratos JSON también se pueden consultar sin JWT cuando están habilitados:

| Definición | Ruta en Gateway |
| --- | --- |
| Auth | `/openapi/auth` |
| Catálogo | `/openapi/catalog` |

Para guardarlos desde el entorno Compose:

```bash
curl --fail http://localhost:18080/openapi/auth -o auth-openapi.json
curl --fail http://localhost:18080/openapi/catalog -o catalog-openapi.json
```

Estas rutas admiten únicamente `GET` y `HEAD`. Auth y Catalog también generan
`/v3/api-docs` y `/v3/api-docs.yaml` directamente, pero los contratos usan `/v1` y
sus solicitudes de prueba deben ejecutarse desde el Gateway. Actuator y los
endpoints internos de mensajería quedan fuera de los contratos.

### Endpoints cubiertos

Todas las rutas siguientes incluyen el prefijo público `/v1` al usar Gateway.

| Método y ruta interna | Éxito | JWT requerido |
| --- | --- | --- |
| `POST /auth/register` | `201`, cliente registrado | No |
| `POST /auth/verificacion` | `200`, correo verificado | No |
| `POST /auth/verificacion/reenviar` | `202`, sin cuerpo | No |
| `POST /auth/login` | `200`, access token y refresh token | No |
| `POST /auth/refresh` | `200`, nuevo par de tokens | No |
| `POST /auth/logout` | `204`, sin cuerpo | Sí |
| `GET /auth/users/me` | `200`, perfil propio | Sí |
| `PATCH /auth/users/me` | `200`, perfil actualizado | Sí |
| `PATCH /auth/users/me/password` | `200`, sin cuerpo | Sí |
| `POST /auth/password/recovery` | `202`, sin cuerpo | No |
| `POST /auth/password/reset` | `204`, sin cuerpo | No |
| `GET /catalog/campus` | `200`, lista con cafeterías | No |
| `GET /catalog/categorias` | `200`, lista de categorías | No |
| `GET /catalog/productos` | `200`, página de productos | Sí |
| `GET /catalog/productos/{id}/ofertas` | `200`, lista por precio ascendente | Sí |

Logout (INT2-23), perfil (INT2-24) y cambio de contraseña (INT2-25) ya están
integrados en la base actual; no quedan endpoints pendientes de la lista mínima
de INT2-31. El mapping interno de perfil es `/auth/users`, porque Gateway elimina
`/v1` antes de reenviar. Esta documentación conserva las reglas actuales de JWT,
aunque el controlador de catálogo se denomine “PublicCatalogController”.

Productos requiere `campusId` y admite `categoriaId`, `q`, `page`, `size` y `sort`.
`q` busca en nombre y descripción sin distinguir mayúsculas. La página empieza
en cero, usa 20 elementos por defecto y admite hasta 2000. Se conserva la
serialización actual de `Page`, incluidos `content`, `pageable`, `sort`, `number`,
`size`, `totalElements`, `totalPages`, `first`, `last`, `numberOfElements` y `empty`.
Las búsquedas y ofertas sin coincidencias devuelven una página/lista vacía.

### Errores y particularidades del contrato actual

Los errores usan `application/problem+json` (RFC 9457), con `type`, `title`,
`status`, `detail`, `instance` y `timestamp`. Los errores de validación de campos
incluyen `errors`, una lista de `{field, message}` sin valores rechazados.
`instance` corresponde al proceso que genera el error: los errores reenviados de
Auth/Catalog conservan la ruta interna, y el rate limit del Gateway usa `/v1`.

Swagger documenta los errores principales de cada operación: validación `400`,
credenciales/JWT/refresh inválidos `401`, cuenta sin verificar `403`, cuenta
inexistente en reenvío `404`, conflictos `409`, formato de entrada `415` y errores
internos `500`. En las rutas públicas no se necesita JWT; enviar un Bearer inválido
sigue produciendo `401`.

Login, recuperación y reenvío incluyen `429` y el encabezado **Retry-After**
(segundos), producidos exclusivamente por el Gateway. Véase la sección de rate
limiting para las cuotas y su configuración.

La documentación refleja estas diferencias ya existentes: cambio de contraseña
exige un mínimo de 6 caracteres, mientras registro y reset exigen 8. En perfil, una
contraseña actual incorrecta produce `401` y un usuario no encontrado produce `404`.

Revocación de sesiones: logout revoca solo el refresh token del dispositivo.
Refresh rota su token. Reset y cambio de contraseña de perfil revocan todos los
refresh tokens del usuario en la misma transacción que actualiza el hash. En todos
los casos los access tokens ya emitidos son JWT stateless y **siguen vigentes hasta
su expiración** (`cloudcoffee.jwt.access-token-ttl`, 15 minutos por defecto); al
expirar, el cliente no puede renovarlos y debe iniciar sesión de nuevo.

### Verificación

Desde `backend`, ejecutar:

```bash
./auth-service/mvnw -f pom.xml clean verify
```

Las pruebas comprueban documentación habilitada/deshabilitada, campos y schemas,
respuestas vacías, restricciones JWT, paginación real, rutas de proxy, UI/configuración
de Swagger y errores del servicio remoto. Se mantienen las pruebas de CORS,
rate limiting y los flujos previos.

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
No sobrescribir un par existente: cambiarlo invalida los JWT firmados con él.

Docker Compose monta ambos archivos en Auth mediante `secrets`; Gateway, Catalog,
Order y Notification reciben **únicamente la pública**. Las rutas del host se
configuran con `JWT_PRIVATE_KEY_FILE` y `JWT_PUBLIC_KEY_FILE` en `.env`.
No copiar la privada a imágenes, recursos del classpath ni otros servicios.

### Permisos de la privada en Docker

Después de generar las llaves, basta con `docker compose up --build -d`: no se
necesitan `chmod` ni `chown` manuales sobre la privada del host. Compose conserva
los permisos de los secretos basados en archivos; configurar `uid`, `gid` o
`mode` en ese montaje no resuelve esa limitación.

Auth usa el target `auth-runtime` del Dockerfile. Su entrypoint comienza como
root **solo para preparar la llave**: lee `/run/secrets/jwt_private_key` y crea
una copia en `/run/cloudcoffee-jwt/jwt_private_key`, dentro del `tmpfs` exclusivo
del contenedor. La copia pertenece a `spring:spring`, tiene permiso `0400` y su
directorio tiene permiso `0700`. El archivo original permanece de solo lectura,
sin cambiar su propietario, contenido ni permisos, incluso si tiene modo `0600`
o `0400` y pertenece a otro UID.

Luego `exec su-exec spring:spring` inicia Java como PID 1, sin privilegios de root;
`no-new-privileges` impide recuperarlos mediante ejecutables setuid. El tmpfs se
vuelve a preparar en cada arranque y su contenido desaparece al detener el
contenedor. La copia no se escribe en la imagen ni en un volumen persistente
(el manejo de swap del host sigue siendo responsabilidad del entorno).
Si falta el tmpfs o la privada está ausente, vacía o no puede leerse, Auth falla
antes de iniciar Java. Gateway y los demás servicios conservan el target por
defecto `service-runtime`, el usuario `spring` y únicamente la llave pública.

La preparación funciona con archivos que el motor Docker pueda montar y leer;
no evita restricciones externas como ACL del host o políticas de SELinux.

Prueba reproducible desde la raíz, con Docker disponible y una shell POSIX
(por ejemplo Git Bash en Windows con Docker Desktop usando contenedores Linux):

```bash
sh backend/docker/test-jwt-permissions.sh
```

La prueba usa un volumen temporal con una llave ficticia, modos `0400`, `0600`
y `0644`, y UID/GID ajenos a `spring`. Comprueba lectura, propietario y permisos
de la copia, ejecución sin root, reinicios, conservación del origen y rechazo
cuando falta la llave o el tmpfs. No necesita PostgreSQL, RabbitMQ ni llaves reales.

### Ejecución sin Docker y contrato JWT

Al ejecutar sin Docker, configurar `JWT_PUBLIC_KEY_LOCATION` en cada proceso y
`JWT_PRIVATE_KEY_LOCATION` **solo en Auth**. Usar URLs de archivo absolutas, por
ejemplo `file:/ruta/secrets/jwt-public.pem` o `file:/C:/ruta/secrets/jwt-public.pem`.
El arranque falla si falta la llave pública, es inválida o tiene menos de 2048 bits;
Auth también falla si falta la privada o no corresponde al mismo par.

`JwtTokenService.emitir(Usuario)` firma el identificador persistido (`sub`) y el
rol real del usuario (`role`: `CLIENTE`, `CAJERO`, `ADMIN_CAFETERIA`, `SUPER_ADMIN`),
con fecha de emisión (`iat`) y vencimiento (`exp`). La duración predeterminada es
15 minutos, configurable mediante `cloudcoffee.jwt.access-token-ttl` (por ejemplo
`PT15M`). `LoginService` autentica y comprueba la verificación del correo antes
de emitir el JWT; `RefreshTokenService` lo renueva al rotar un refresh token vigente.
Los contratos de login, refresh y logout se detallan en la sección OpenAPI.

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

Los endpoints de monitoreo de todos los servicios (`GET`/`HEAD`
`/actuator/health` y `/actuator/info`) conservan su acceso público directo. Solo
se expone el estado general, sin detalles de componentes internos; no se agrega
una ruta de Gateway para inspeccionar los Actuator de otros servicios.

La lista mantiene el contrato previo del Gateway; no crea endpoints que todavía
no estén implementados. Todas las demás rutas de los microservicios requieren JWT,
incluido `/internal/test/events` cuando está habilitado. Los preflight CORS siguen
resolviéndose en Gateway sin JWT. Una petición pública **sin Bearer** es anónima;
si envía un Bearer inválido se rechaza con 401.

Las pruebas generan llaves temporales, sin credenciales versionadas. `clean verify`
comprueba firma y roles emitidos por Auth, rechazo de tokens vencidos, adulterados,
firmados por otra llave o algoritmo, claims obligatorios, acceso directo a cada
servicio, rutas públicas, propagación del token, CORS y los flujos previos del backend.

## Logout por dispositivo (INT2-23)

Enviar `POST /v1/auth/logout` al Gateway (o `POST /auth/logout` directamente a Auth)
con `Authorization: Bearer <accessToken>` y el refresh token actual del dispositivo:

```json
{"refreshToken": "<refreshToken>"}
```

La respuesta es `204 No Content`. Auth comprueba que el token sea de tipo `REFRESH`
y pertenezca al usuario del JWT, y registra su revocación. Otras sesiones conservan
sus refresh tokens. Repetir el logout con el mismo token devuelve `204` sin cambiar
la revocación; intentar renovarlo devuelve `401`. Logout y refresh bloquean la misma
fila durante la transacción para serializar operaciones sobre ese token.

Sin JWT válido se devuelve `401`; un refresh token inexistente, de otro usuario o
de otro tipo también devuelve `401`. Un cuerpo sin refresh token devuelve `400`.
El access token conserva su vencimiento original; este endpoint revoca el refresh
token de la sesión y no agrega una lista de revocación de JWT.

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

## Rate limiting en API Gateway (INT2-16)

Bucket4j limita únicamente estos `POST`, con una cuota independiente por IP y ruta:

| Ruta pública | Capacidad inicial | Recarga completa | Variables de entorno |
| --- | --- | --- | --- |
| `/v1/auth/login` | 5 | 1 minuto | `RATE_LIMIT_LOGIN_CAPACITY`, `RATE_LIMIT_LOGIN_REFILL_PERIOD` |
| `/v1/auth/password/recovery` | 3 | 15 minutos | `RATE_LIMIT_PASSWORD_RECOVERY_CAPACITY`, `RATE_LIMIT_PASSWORD_RECOVERY_REFILL_PERIOD` |
| `/v1/auth/verificacion/reenviar` | 3 | 15 minutos | `RATE_LIMIT_VERIFICATION_RESEND_CAPACITY`, `RATE_LIMIT_VERIFICATION_RESEND_REFILL_PERIOD` |

Configurar las variables en `.env` para Docker Compose o en el entorno del Gateway
cuando se ejecuta por separado. Los periodos aceptan `Duration`, por ejemplo `PT1M`
o `PT15M`. Las propiedades equivalentes son
`cloudcoffee.rate-limit.<login|password-recovery|verification-resend>.capacity`
y `.refill-period`. Capacidades y periodos deben ser positivos; una configuración
inválida impide el arranque. Los cambios requieren reiniciar el Gateway.

Cada intento consume un token antes de autenticar o reenviar, incluso si Auth
rechaza el login o el cuerpo es inválido. Al agotarse la cuota, el Gateway devuelve
**HTTP 429**, `application/problem+json` con el contrato RFC 9457 existente y
`Retry-After` en segundos redondeados hacia arriba. La solicitud bloqueada no llega
a Auth. La cuota vuelve a llenarse al terminar cada periodo desde su creación.
Los demás endpoints, métodos y preflight CORS conservan su comportamiento.

La IP se obtiene de `getRemoteAddr()`; el filtro no interpreta `X-Forwarded-For`
ni `Forwarded`. Si se despliega detrás de un proxy, la infraestructura debe
establecer la IP real exclusivamente desde proxies confiables antes del filtro.
Sin esa configuración, los clientes detrás del proxy comparten su cuota.

Los buckets viven en memoria en cada instancia del Gateway, se eliminan tras un
periodo sin uso y se reinician con el proceso. No comparten cuotas entre réplicas.
Esta protección se aplica al acceso a través del Gateway; los puertos internos de
Auth deben quedar restringidos a la infraestructura del backend.

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
