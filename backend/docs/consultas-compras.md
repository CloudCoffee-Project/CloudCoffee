# Consultas del comprador · INT2-72

Implementación de las lecturas de [INT2-50](compra-pago-retiro.md), con los schemas
`Compra`, `Orden` y `PaginaCompras` del [contrato OpenAPI](compra-pago-retiro.openapi.json).
El acceso del cajero, su listado y la validación de asignación quedan en INT2-78.
No se agregan pantallas web o móvil ni comandos de creación/revisión.

## Rutas implementadas

| Ruta pública en Gateway | Respuesta |
| --- | --- |
| `GET /v1/compras?page=0&size=20` | `200 PaginaCompras`, solo compras del JWT. |
| `GET /v1/compras/{compraId}` | `200 Compra`, con todas sus órdenes, incluso canceladas, y pago actual o `null`. |
| `GET /v1/orders/{ordenId}` | `200 Orden`, solo si su compra pertenece al JWT. |

Order recibe las mismas rutas sin `/v1`. Las tres requieren JWT RS256 vigente
con rol `CLIENTE` y `sub` UUID. Ningún parámetro de propietario, cafetería o
ordenamiento permite cambiar el alcance: la identidad se obtiene del token firmado.
`CAJERO`, `ADMIN_CAFETERIA` y `SUPER_ADMIN` reciben `403` en estas lecturas.

Las respuestas de éxito incluyen `Cache-Control: no-store`. No requieren
`Idempotency-Key`. Son consultas sin efectos: no renuevan reservas, no procesan
pagos y no ejecutan transiciones, aunque haya vencido `reservaExpiraAt`. Los jobs
y comandos responsables de esas transiciones pertenecen a sus propias issues.

## Historial y snapshots

`page` empieza en cero; `size` va de 1 a 100 y vale 20 por defecto. Las compras se
ordenan por `creadoAt DESC, id DESC`. Los totales y el conteo incluyen solamente
compras propias. Una página fuera de rango tiene `content: []`, conservando
`totalElements` y `totalPages`. Sin compras, `totalPages: 0`, `first/last: true`.

```http
GET /v1/compras?page=0&size=20
Authorization: Bearer <jwt-cliente>
```

Ejemplo sin compras:

```json
{
  "content": [],
  "number": 0,
  "size": 20,
  "totalElements": 0,
  "totalPages": 0,
  "first": true,
  "last": true,
  "empty": true
}
```

Cada elemento de `content` es una `Compra` completa. Sus órdenes conservan los
nombres e importes de los ítems guardados: no se consulta Catalog para actualizar
precios ni nombres. Los importes se serializan como pesos CLP enteros, los estados
como snake_case y las fechas como UTC RFC 3339. `version` empieza en 1 y representa
la versión persistida de cada recurso, sin incrementarse por leerlo.

Las compras anteriores a V4 y los seeds mínimos de pagos no tienen snapshots de
órdenes. Se conserva `ordenes: []` y su importe/pago original; no se fabrican ítems.
Ejemplo de consulta de una de esas compras, antes de iniciar un pago:

```http
GET /v1/compras/77777777-7777-4777-8777-777777777701
Authorization: Bearer <jwt-del-comprador-seed>
```

```json
{
  "compraId": "77777777-7777-4777-8777-777777777701",
  "clienteId": "66666666-6666-4666-8666-666666666601",
  "estado": "pendiente_pago",
  "montoTotal": 3700,
  "moneda": "CLP",
  "ordenes": [],
  "pago": null,
  "reservaExpiraAt": "2026-10-01T12:15:00Z",
  "creadoAt": "2026-10-01T12:00:00Z",
  "actualizadoAt": "2026-10-01T12:00:00Z",
  "version": 1
}
```

Las fechas de esta respuesta son ilustrativas: las reales proceden de la base.
Para una compra con órdenes, se devuelve el ejemplo completo
de `Compra` en OpenAPI. Cada orden también puede consultarse por separado:

```http
GET /v1/orders/40000000-0000-4000-8000-000000000001
Authorization: Bearer <jwt-propietario>
```

Devuelve el schema `Orden`, con `items`, fechas de reserva/retiro/entrega y versión.
No incluye credenciales de retiro, referencias del proveedor ni datos internos
de idempotencia. `pago`, cuando existe, usa exactamente la representación de
`GET /v1/compras/{compraId}/pago`, incluido `simulado: true`.

La paginación se hace en base de datos sobre compras, antes de cargar órdenes,
ítems y pagos en lotes. Cada respuesta se construye dentro de una transacción de
solo lectura con aislamiento `REPEATABLE_READ`, para que sus datos y conteo
correspondan al mismo snapshot. No se serializan entidades ni se depende de OSIV.

## Errores

Se devuelve `application/problem+json` de `common-errors`, con `type`, `title`,
`status`, `detail`, `instance` y `timestamp`. Los errores de dominio agregan `code`
y `traceId` cuando hay una traza activa. Errores de seguridad o conversión pueden
no incluir esas extensiones.

| HTTP | Caso | Código de dominio |
| --- | --- | --- |
| 400 | `page < 0` o `size` fuera de 1–100 | `PAGINACION_INVALIDA` |
| 400 | UUID o número malformado | Sin código de dominio. |
| 401 | JWT ausente, inválido o vencido | Contrato de seguridad compartido. |
| 403 | Rol distinto de CLIENTE | `ROL_NO_PERMITIDO` |
| 403 | `sub` no representa un UUID | `USUARIO_INVALIDO` |
| 404 | Compra ajena o inexistente | `COMPRA_NO_ENCONTRADA` |
| 404 | Orden ajena o inexistente | `ORDEN_NO_ENCONTRADA` |

Ajeno e inexistente producen el mismo mensaje y código para no revelar existencia:

```json
{
  "type": "/problems/compra-no-encontrada",
  "title": "Compra no encontrada",
  "status": 404,
  "detail": "No existe una compra con el identificador indicado.",
  "instance": "/compras/30000000-0000-4000-8000-000000000001",
  "timestamp": "2026-11-01T21:00:00Z",
  "code": "COMPRA_NO_ENCONTRADA",
  "traceId": "aabbccddeeff00112233445566778899"
}
```

## Verificación

Desde `backend`, con Java 21:

```bash
./auth-service/mvnw --batch-mode --no-transfer-progress -pl order-service -am clean verify
```

`ConsultaComprasControllerTest` prueba JWT firmado, aislamiento por propietario,
roles, datos históricos, pago actual, límites y orden de paginación, páginas
vacías, lecturas sin efectos y carga de colecciones en lotes. CI ejecuta la misma
suite con PostgreSQL 16 además de H2.
