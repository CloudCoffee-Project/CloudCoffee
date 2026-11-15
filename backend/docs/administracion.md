# Contrato de administración y permisos · INT2-109

Versión **1.0.0**. [Decisión de arquitectura](decisiones/0002-administracion-cuatro-roles.md) ·
[OpenAPI](administracion.openapi.json) · [Eventos](administracion.eventos.json).
Define lo que implementarán las issues de administración de Sprint 3; no afirma que
estas rutas existan hoy. Reutiliza `common-security`, Problem Details de
`common-errors` y las convenciones de paginación e idempotencia de
[INT2-50](compra-pago-retiro.md), que no cambian.

## Roles y alcance

| Rol | Alcance | Cómo se comprueba |
| --- | --- | --- |
| `CLIENTE` | Sus propios recursos (propietario) | `sub` del JWT igual al dueño del recurso |
| `CAJERO` | Operación diaria de **su cafetería asignada** | Asignación persistida en Auth, consultada en cada solicitud |
| `ADMIN_CAFETERIA` | Gestión y operación de **su cafetería asignada** | Ídem |
| `SUPER_ADMIN` | Plataforma completa: campus, cafeterías, catálogo maestro, cuentas y ventas globales | Rol del JWT; **no** hereda permisos operativos |

Reglas comunes:

* **Nunca autorizar con el claim `cafeteriaId`**. Es un dato para la UI. La
  autorización usa `CafeteriaAccess` o `AsignacionesCafeteria` de `common-security`.
* **Asignación revocada o cuenta desactivada rige en la siguiente solicitud**: Auth
  responde que no hay asignación vigente y el servicio responde `403`.
* **Si Auth no responde, se niega** (`403`, falla cerrado). Las operaciones que
  dependen de otro servicio para decidir (baja propia, alta de personal) responden
  `503 OPERACION_PENDIENTE` sin cambiar nada.
* **No existe un rol por campus.** El alcance por campus solo aparece como filtro
  de `SUPER_ADMIN` en ventas y listados.
* **Ningún rol hereda permisos de otro por su nombre**, igual que en INT2-50.

## Matriz de operaciones

✅ global · 🏪 solo su cafetería asignada · 👤 solo lo propio · ❌ `403`

### Cuentas (Auth)

| Operación | Ruta | CLIENTE | CAJERO | ADMIN_CAFETERIA | SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- |
| Registrarse (siempre `CLIENTE`) | `POST /v1/auth/register` (existe) | anónimo | — | — | — |
| Ver y editar perfil propio | `/v1/auth/users/me` (existe) | 👤 | 👤 | 👤 | 👤 |
| Dar de baja la cuenta propia | `POST /v1/auth/users/me/baja` | 👤 | ❌ | ❌ | ❌ |
| Activar cuenta invitada | `POST /v1/auth/activacion` | anónimo con token | | | |
| Listar cuentas | `GET /v1/auth/admin/usuarios` | ❌ | ❌ | 🏪 solo `CAJERO` | ✅ |
| Ver cuenta | `GET /v1/auth/admin/usuarios/{id}` | ❌ | ❌ | 🏪 solo `CAJERO` | ✅ |
| Invitar personal | `POST /v1/auth/admin/personal` | ❌ | ❌ | 🏪 solo `CAJERO` | ✅ `CAJERO` o `ADMIN_CAFETERIA` |
| Reenviar invitación | `POST .../usuarios/{id}/invitacion` | ❌ | ❌ | 🏪 | ✅ |
| Editar datos de contacto | `PATCH .../usuarios/{id}` | ❌ | ❌ | 🏪 solo `CAJERO` | ✅ |
| Reasignar cafetería | `PUT .../usuarios/{id}/asignacion` | ❌ | ❌ | ❌ | ✅ |
| Desactivar o reactivar | `POST .../usuarios/{id}/desactivar` y `/reactivar` | ❌ | ❌ | 🏪 solo `CAJERO` | ✅ excepto a sí mismo |
| Dar de baja (anonimizar) | `POST .../usuarios/{id}/baja` | ❌ | ❌ | 🏪 solo `CAJERO` | ✅ excepto a sí mismo |

### Catálogo y cafeterías (Catalog)

| Operación | Ruta | CLIENTE | CAJERO | ADMIN_CAFETERIA | SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- |
| Consultas públicas | `GET /v1/catalog/...` (existen) | ✅ | ✅ | ✅ | ✅ |
| Seguimientos de productos (INT2-116) | `/v1/catalog/seguimientos/**` (existe) | 👤 | ❌ | ❌ | ❌ |
| Campus: listar, crear, editar, baja, reactivar | `/v1/catalog/admin/campus/**` | ❌ | ❌ | ❌ | ✅ |
| Cafeterías: listar, crear, editar, baja, reactivar | `/v1/catalog/admin/cafeterias/**` | ❌ | ❌ | ❌ | ✅ |
| Cierre operativo (abrir/cerrar) | `POST /v1/catalog/cafeterias/{id}/estado-operativo` | ❌ | ❌ | 🏪 | ❌ |
| Categorías: listar, crear, editar, baja, reactivar | `/v1/catalog/admin/categorias/**` | ❌ | ❌ | ❌ | ✅ |
| Productos: listar, crear, editar, baja, reactivar | `/v1/catalog/admin/productos/**` | ❌ | ❌ | ❌ | ✅ |
| Inventario de la cafetería | `GET /v1/catalog/cafeterias/{id}/ofertas` (existe) | ❌ | 🏪 | 🏪 | ❌ |
| Crear oferta, cambiar precio, baja, reactivar | `/v1/catalog/cafeterias/{id}/ofertas/**` | ❌ | ❌ | 🏪 | ❌ |
| **Ajustar stock** | `POST .../ofertas/{ofertaId}/ajustes-stock` | ❌ | 🏪 | 🏪 | ❌ |
| Historial de ajustes | `GET .../ofertas/{ofertaId}/ajustes-stock` | ❌ | 🏪 | 🏪 | ❌ |

### Ventas y comprobantes (Order)

| Operación | Ruta | CLIENTE | CAJERO | ADMIN_CAFETERIA | SUPER_ADMIN |
| --- | --- | --- | --- | --- | --- |
| Compras propias, pago | `/v1/compras/**` (existe, INT2-50) | 👤 | ❌ | ❌ | ❌ |
| Pedidos y retiro | `/v1/orders/**` (existe, INT2-50) | 👤 lectura | 🏪 | ❌ | ❌ |
| Ventas y resumen | `GET /v1/orders/ventas` y `/ventas/resumen` | ❌ | ❌ | 🏪 | ✅ |
| Comprobante interno de una orden | `GET /v1/orders/{ordenId}/comprobante` | 👤 | 🏪 | 🏪 | ✅ |
| Historial de notificaciones | `GET /v1/notifications` (existe) | ❌ | ❌ | ❌ | ✅ |

## Convenciones

* **Paginación:** la forma de INT2-50 (`content, number, size, totalElements,
  totalPages, first, last, empty`), con `page >= 0` y `1 <= size <= 100`, 20 por
  defecto. Cada listado tiene un orden fijo, indicado en el OpenAPI. Los listados
  públicos existentes de Catalog conservan su serialización actual.
* **Altas** (`POST` que crea): exigen `Idempotency-Key` UUID con la semántica de
  INT2-50: misma clave y cuerpo reproduce la respuesta con `Idempotency-Replayed:
  true`; misma clave con otro cuerpo, `409 IDEMPOTENCY_CONFLICT`. Responden `201`
  con `Location`.
* **Ediciones** (`PATCH`/`PUT`): exigen `version` en el cuerpo. Si no coincide con
  la actual: `409 VERSION_CONFLICTO` y no se cambia nada.
* **Transiciones** (`baja`, `reactivar`, `desactivar`): sin cuerpo y repetibles.
  Repetir sobre el estado final devuelve `200` con el recurso, sin cambios ni eventos.
* **Textos:** se recortan los espacios exteriores antes de validar. Los nombres son
  únicos sin distinguir mayúsculas: campus, categoría, producto, cafetería dentro
  de su campus. Duplicado: `409 NOMBRE_DUPLICADO`.
* **Importes:** precios enteros en CLP entre 1 y 1.000.000, impuestos incluidos.
* **Respuestas con datos de cuentas, ventas o comprobantes:** `Cache-Control: no-store`.

## Cuentas de personal

### Alta por invitación

1. `ADMIN_CAFETERIA` invita un `CAJERO` para su cafetería: omite `cafeteriaId` o
   envía la suya. Otra cafetería: `403 ASIGNACION_NO_AUTORIZADA`. Otro rol: `403`.
2. `SUPER_ADMIN` invita `CAJERO` o `ADMIN_CAFETERIA` e indica `cafeteriaId`. Auth la
   confirma con Catalog (`GET /internal/servicios/catalogo/cafeterias/{id}`):
   inexistente `404`; dada de baja `409 CAFETERIA_DADA_DE_BAJA`; Catalog caído `503`.
3. Auth crea la cuenta en `pendiente_activacion`, **sin contraseña utilizable**, y
   un token de activación: 32 bytes aleatorios en Base64URL (43 caracteres), de un
   solo uso, válido 72 horas. Guarda solo su hash (`tokens_auth`, tipo nuevo
   `ACTIVACION_CUENTA`).
4. Publica `auth.personal.invitacion.v1`. Notification envía el correo con el
   enlace web `{FRONTEND_URL}/activar-cuenta?token=...`. El enlace móvil
   `cloudcoffee://activar-cuenta?token=...` ya lo espera la pantalla
   `activar-cuenta` de la app (INT4-101).
5. La persona envía `POST /v1/auth/activacion` con `token` y su `password` (8 a 72
   caracteres, misma regla que registro y restablecimiento). La cuenta queda
   `activa` y verificada, y el token se consume.

Reglas de seguridad:

* **Nadie fija ni conoce la contraseña de otra persona.** La API no acepta
  contraseñas en altas ni ediciones de personal.
* **Email ya registrado: `409 EMAIL_YA_REGISTRADO`.** No se convierte una cuenta
  existente en personal, así que el registro público no sirve para escalar privilegios.
* **No hay cambio de rol.** Para otro rol se invita una cuenta nueva.
* **No se crea `SUPER_ADMIN` por API.** Se aprovisiona por operación del sistema.
* Reenviar la invitación revoca el token anterior. Las cuentas de prueba con
  contraseña conocida existen solo en el perfil `dev` (INT2-65).

### Desactivar, reasignar y baja

* **Desactivar** (reversible): `activo=false` y se revocan los refresh tokens. Auth
  deja de informar asignación, así que el personal pierde el acceso en la siguiente
  solicitud. Login y refresh ya rechazan cuentas inactivas (INT2-105).
* **Reasignar** (solo `SUPER_ADMIN`): cambia `cafeteriaId` y revoca refresh tokens.
* **Baja** (irreversible): anonimiza, con las mismas reglas que la baja propia.
* `SUPER_ADMIN` no puede desactivarse ni darse de baja a sí mismo
  (`409 OPERACION_SOBRE_SI_MISMO`). Dar de baja al último `SUPER_ADMIN` activo:
  `409 ULTIMO_SUPER_ADMIN`.

## Baja propia, anonimización y conservación

`POST /v1/auth/users/me/baja` con `passwordActual`, solo para `CLIENTE`. El personal
lo gestiona su administrador.

1. **Contraseña incorrecta:** `401 CONTRASENA_INCORRECTA`, igual que el cambio de
   contraseña actual.
2. **Compras en curso:** Auth consulta a Order
   (`GET /internal/servicios/compras/usuarios/{id}/en-curso`). Están en curso las
   compras en `revision_requerida` o `pendiente_pago`, y las órdenes pagadas aún no
   entregadas ni cerradas. Si hay alguna: `409 COMPRAS_EN_CURSO`. Si Order no
   responde: `503 OPERACION_PENDIENTE`, sin cambios.
3. **Efectos, en una transacción de Auth:**
   * `eliminado=true` y `activo=false`;
   * email reemplazado por `eliminado+{usuarioId}@anonimo.invalid`, que libera el
     correo para un registro futuro sin vínculo con la cuenta anterior;
   * nombre y apellido `Usuario eliminado`, teléfono `000000`;
   * contraseña reemplazada por un hash aleatorio;
   * revocación de todos sus tokens y borrado de su asignación si la tuviera.
4. **Publica `auth.usuario.anonimizado.v1`.** Notification elimina los datos
   personales (email, nombre) de su historial asociado a ese `usuarioId`.
5. **Conservación:** compras, órdenes, ítems, pagos y comprobantes **se conservan**.
   Order y Payment solo guardan `clienteId` como referencia pseudónima, sin datos
   personales, así que no requieren cambios.

Las cuentas dadas de baja no aparecen en los listados y no pueden reactivarse.

## Catálogo: baja lógica y cierre operativo

| Recurso | Cierre operativo (temporal) | Baja lógica | Restricción para la baja |
| --- | --- | --- | --- |
| Campus | — | `activo=false` | Sin cafeterías activas: si no, `409 CAMPUS_EN_USO` |
| Cafetería | `OPEN`, `CLOSED`, `MAINTENANCE` (su `ADMIN_CAFETERIA`) | `activa=false` + `bajaAt` (`SUPER_ADMIN`) | Ninguna |
| Categoría | — | `activa=false` | Sin productos activos: si no, `409 CATEGORIA_EN_USO` |
| Producto | — | `INACTIVE` (estado existente) | Ninguna |
| Oferta | `AVAILABLE` / `OUT_OF_STOCK` (derivado del stock) | `activa=false` + `bajaAt` | Ninguna |

Efectos comunes:

* **Un recurso cerrado o dado de baja deja de venderse**: las cotizaciones y
  reservas nuevas responden el `409 OFERTA_NO_DISPONIBLE` existente.
* **Lo ya vendido se respeta.** Las reservas vigentes se confirman o vencen según
  INT2-50/77 y las órdenes pagadas siguen su ciclo de retiro.
* Una cafetería nueva nace activa y `CLOSED`: abrirla es decisión de su administrador.
* **Una oferta dada de baja se reactiva**, no se recrea: el par cafetería/producto es
  único y crear otra responde `409 OFERTA_EXISTENTE`. Reactivar conserva precio y stock.
* **Cambiar un precio no altera reservas ni órdenes**, que guardan su snapshot. Las
  órdenes en revisión aplican `PRECIO_CAMBIO` de INT2-73.
* Ofrecer un producto inactivo o de categoría inactiva: `409 PRODUCTO_INACTIVO`.
* Mover una cafetería de campus no está permitido.

## Stock

* **Regla confirmada por el solicitante:** `CAJERO` y `ADMIN_CAFETERIA` ajustan
  stock **solo de su cafetería asignada**. `SUPER_ADMIN` no tiene este permiso.
* **El stock no se escribe directamente.** Cada ajuste es un registro con
  `cantidad` (delta distinto de cero, entre -10.000 y 10.000), `motivo`
  (`REPOSICION`, `MERMA`, `CORRECCION_INVENTARIO`, `REINGRESO_NO_RETIRADO`) y `nota`
  opcional. El registro es inmutable y guarda autor, fecha y stock anterior y actual.
* **El delta se aplica atómicamente** bajo el mismo bloqueo de la oferta que usan las
  reservas (INT2-51), así que no se pisa con compras concurrentes. Si el resultado
  quedara negativo: `409 STOCK_NEGATIVO` y no se registra nada.
* `stock` es la disponibilidad vendible: las unidades reservadas ya están
  descontadas, igual que hoy. Cada ajuste publica el `catalog.stock.actualizado.v1`
  existente, que actualiza las pantallas por WebSocket.
* `REINGRESO_NO_RETIRADO` cubre el caso de uso «Reingresar ítem a stock». Vencer un
  retiro no devuelve stock automáticamente (INT2-50).

## Ventas y comprobante interno

**Ventas** (`ADMIN_CAFETERIA` de su cafetería y `SUPER_ADMIN`):

* Cuentan las órdenes de compras con pago aprobado: estados `pagado`,
  `listo_para_retiro`, `entregado`, `no_retirado_pendiente_revision` y
  `no_retirado_final`.
* Filtros `desde` y `hasta` (fechas inclusivas en `America/Santiago`, por defecto
  los últimos 30 días, máximo 92 días) y `estado`. `SUPER_ADMIN` también filtra por
  `cafeteriaId` y `campusId`. Si `ADMIN_CAFETERIA` pide otra cafetería: `403`.
* Cada venta incluye código, cafetería, campus, estado, monto, cantidad de ítems y
  fechas de pago y entrega. **No incluye datos personales del comprador.**
* `/ventas/resumen` entrega totales del periodo, por estado y por cafetería.

**Comprobante interno** (`GET /v1/orders/{ordenId}/comprobante`):

* Snapshot de la orden pagada: número (`codigoOrden`), cafetería, fecha de pago,
  ítems con precio y subtotal, total y proveedor de pago. Lleva la leyenda
  «Documento interno sin validez tributaria» y no incluye datos del comprador.
* Acceso: el `CLIENTE` dueño, `CAJERO` y `ADMIN_CAFETERIA` de esa cafetería, y
  `SUPER_ADMIN`. Orden ajena o inexistente: `404`. Orden sin pago aprobado:
  `409 ESTADO_INVALIDO`.
* Corresponde a la entidad «Boleta» del diagrama. La boleta electrónica tributaria
  queda fuera de alcance.

## Errores

Problem Details de `common-errors` con las extensiones `code` y `traceId` de
INT2-50. Los errores de seguridad o del Gateway pueden no traer `code`.

| HTTP | Cuándo | `code` |
| --- | --- | --- |
| 400 | Validación, JSON, parámetros, rango de fechas | (lista `errors`) |
| 400 | Token de activación desconocido, vencido o usado | `TOKEN_ACTIVACION_INVALIDO` |
| 401 | JWT ausente, inválido o vencido | — |
| 401 | Contraseña actual incorrecta en la baja propia | `CONTRASENA_INCORRECTA` |
| 403 | Rol sin permiso para la operación | `ROL_NO_PERMITIDO` |
| 403 | Sin asignación, asignación revocada, otra cafetería en la ruta, o Auth no responde | `ASIGNACION_NO_AUTORIZADA` |
| 404 | Recurso inexistente o fuera de alcance (cuenta de otra cafetería, oferta de otra cafetería, orden ajena) | según el recurso |
| 409 | Versión distinta | `VERSION_CONFLICTO` |
| 409 | Clave reutilizada con otro cuerpo | `IDEMPOTENCY_CONFLICT` |
| 409 | Unicidad | `EMAIL_YA_REGISTRADO`, `NOMBRE_DUPLICADO`, `OFERTA_EXISTENTE` |
| 409 | Reglas de baja | `CAMPUS_EN_USO`, `CATEGORIA_EN_USO`, `CAFETERIA_DADA_DE_BAJA`, `PRODUCTO_INACTIVO` |
| 409 | Stock y estado | `STOCK_NEGATIVO`, `ESTADO_INVALIDO` |
| 409 | Cuentas | `COMPRAS_EN_CURSO`, `OPERACION_SOBRE_SI_MISMO`, `ULTIMO_SUPER_ADMIN` |
| 415 | Content-Type distinto de `application/json` | — |
| 503 | Dependencia necesaria para decidir no disponible | `OPERACION_PENDIENTE` |

**Recurso ajeno vs cafetería ajena:** cuando la cafetería viene en la ruta y no es
la asignada, se responde `403`, como hace hoy el inventario del personal. Cuando
se pide por id un recurso que pertenece a otra cafetería, `404`, para no revelar
su existencia.

## Endpoints internos nuevos

Solo con `X-Internal-Service-Token`. El Gateway no los publica (solo enruta `/v1`).
Un JWT de usuario, incluso `SUPER_ADMIN`, no los autoriza.

| Ruta | Servicio | Usado por |
| --- | --- | --- |
| `GET /internal/servicios/compras/usuarios/{usuarioId}/en-curso` | Order | Auth, antes de una baja |
| `GET /internal/servicios/catalogo/cafeterias/{cafeteriaId}` | Catalog | Auth, al invitar o reasignar personal |

El Gateway debe agregar `POST /v1/auth/activacion` a sus rutas públicas, junto a
las demás de Auth.

## Cambios de esquema previstos

Para orientar a las implementaciones. Cada servicio los aplica con una migración
Flyway nueva, sin editar las existentes:

| Servicio | Cambio |
| --- | --- |
| Auth | Tipo de token `ACTIVACION_CUENTA`; columna `version` en `usuarios` |
| Catalog | `campus.activo`; `cafeteria.activa` y `baja_at`; `category.activa`; `offer.activa` y `baja_at`; `version` en campus, cafetería, categoría y producto (la oferta ya la tiene); tabla `ajustes_stock` |
| Order | Snapshot `campus_id` y `pagado_at` en `ordenes`, para filtrar ventas sin consultar a Catalog |

## Evidencia de aceptación

Cada implementación debe cubrir, como mínimo:

* `401` sin JWT o con JWT inválido en todas las rutas no públicas.
* `403` para cada rol no permitido de la matriz, incluido `SUPER_ADMIN` al ajustar
  stock y al cambiar el estado operativo.
* Personal de otra cafetería: `403` con la cafetería en la ruta y `404` con
  recursos por id. Claim `cafeteriaId` alterado o desactualizado: sin efecto.
* Asignación revocada, cuenta desactivada o reasignada: acceso denegado en la
  solicitud siguiente, sin esperar el vencimiento del JWT.
* Auth o Catalog caídos: falla cerrado, sin cambios.
* Alta repetida con la misma clave: un solo recurso y una sola invitación.
  Ediciones concurrentes: una gana y la otra recibe `VERSION_CONFLICTO`.
* Ajustes de stock concurrentes con reservas: stock final exacto, nunca negativo.
* Baja propia con compras en curso, sin ellas y repetida.
* Activación con token vencido, usado o de una invitación reenviada.

Validar el contrato desde la raíz, con `openapi-spec-validator` y `jsonschema` en
un entorno temporal: `python scripts/validate-admin-contract.py`.
