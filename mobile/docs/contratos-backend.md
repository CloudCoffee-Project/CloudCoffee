# Contratos backend vs app móvil

Matriz de dependencias entre los servicios que consume la app móvil (`mobile/src/services/*`)
y el estado del backend. Objetivo: saber qué funciona hoy, qué queda listo para cuando el
backend implemente el controller, y qué requiere algo más que un endpoint REST.

Regla general: **la app nunca mockea en producción**. Todos los servicios usan el
`httpClient` del gateway; si el servidor responde con `problem+json`, la pantalla muestra el
error normalizado (`toApiError`) con botón de reintentar. Cuando el backend implemente su
lado, estas pantallas funcionan **sin cambios en la app**.

| #   | Dominio / feature (issue)                                           | Endpoint(s) que consume la app                                                                               | Estado                                | Dependencia backend                                                                                                                                            |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Catálogo, campus, cafeterías, ofertas y stock (INT4-26…33)          | `GET /v1/catalog/campus` · `/categorias` · `/productos?campusId=&categoriaId=` · `/productos/{id}?campusId=` | ⏳ Listo, backend pendiente           | Catalog-service debe implementar los controllers: hoy tiene solo entidades y repositorios, sin controller ni DTO. Ver la sección de shape del DTO de catálogo. |
| 2   | Autenticación: login, registro, verificación de correo (INT4-19…22) | `POST /v1/auth/login` · `/register` · `/verificacion` (+ `/reenviar`)                                        | ✅ Funciona hoy                       | Auth-service + gateway (`/v1/auth/**` ruteado)                                                                                                                 |
| 3   | Recuperar / restablecer contraseña (INT4-25)                        | `POST /v1/auth/password/recovery` · `/reset`                                                                 | ✅ Funciona hoy                       | Auth-service (mismos `/v1/auth/**`)                                                                                                                            |
| 4   | Perfil: ver y editar datos (INT4-23/24)                             | `GET / PUT /v1/auth/me`                                                                                      | ⏳ Listo, backend pendiente           | Auth-service debe implementar `/me`                                                                                                                            |
| 5   | Notificaciones push: banner y bandeja (INT4-46/47)                  | `POST/DELETE /v1/notifications/device-token`                                                                 | ✅ Funciona hoy                       | Notification-service + gateway (`/v1/notifications/**` ruteado)                                                                                                |
| 6   | Carrito y pago con Mercado Pago (INT4-32…37, Integración II)        | `POST /v1/compras` + checkout MP                                                                             | 🧪 **Mock temporal en `carrito.tsx`** | Order/payment-service; al existir `POST /v1/compras`, se reemplaza el mock por `crearCompra` real                                                              |
| 7   | Seguimientos de productos (INT4-45/53)                              | `GET/POST/DELETE /v1/catalog/seguimientos`                                                                   | ⏳ Listo, backend pendiente           | Catalog-service debe exponer `/seguimientos` (doc: "solo app móvil")                                                                                           |
| 8   | Seguimiento de orden en vivo (INT4-44)                              | WebSocket STOMP `/topic/orden/{id}/estado`                                                                   | 📡 Listo, requiere WS del backend     | Backend debe publicar el topic y el endpoint de suscripción                                                                                                    |
| 9   | Boleta en PDF de una orden (INT4-48)                                | `GET /v1/orders/{id}/boleta`                                                                                 | ⏳ Listo, backend pendiente           | Order-service + gateway debe routear `/v1/orders/**`                                                                                                           |
| 10  | Historial de compras (INT4-50)                                      | `GET /v1/compras`                                                                                            | ⏳ Listo, backend pendiente           | Order-service + gateway debe routear `/v1/compras`                                                                                                             |
| 11  | Cajero: pedidos entrantes (INT4-7)                                  | `GET /v1/orders`                                                                                             | ⏳ Listo, backend pendiente           | Order-service + gateway (`/v1/orders/**`)                                                                                                                      |
| 12  | Cajero: confirmar entrega por QR (INT4-8)                           | `POST /v1/orders/{id}/entregar`                                                                              | ⏳ Listo, backend pendiente           | Ídem                                                                                                                                                           |
| 13  | Cajero: rescatar orden no retirada (INT4-12)                        | `POST /v1/orders/{id}/no-retirado/revisar`                                                                   | ⏳ Listo, backend pendiente           | Ídem                                                                                                                                                           |

## Shape del DTO de catálogo (fila 1)

El gateway ya rutea `/v1/catalog/**` con `StripPrefix=1`, así que las rutas de la app
llegan al Catalog-service como `/campus`, `/categorias` y `/productos`. Lo que falta es
que el servicio las exponga. Las entidades actuales no se pueden serializar directo: usan
nombres en inglés, tienen relaciones `LAZY` y `Product` no expone sus ofertas.

La app consume los tipos de `src/types/domain.ts`, así que el JSON debe usar esos nombres:

```jsonc
// GET /v1/catalog/campus
[{ "id": "uuid", "nombre": "Campus San Francisco", "direccion": "Manuel Montt 056, Temuco",
   "cafeterias": [{ "id": "uuid", "nombre": "Cafetería Central" },
                  { "id": "uuid", "nombre": "Cafetería Norte" }] }]

// GET /v1/catalog/categorias
[{ "id": "uuid", "nombre": "Bebidas" }]

// GET /v1/catalog/productos?campusId=uuid&categoriaId=uuid
[{ "id": "uuid", "nombre": "Café Americano 12oz", "descripcion": "Espresso doble.",
   "categoriaId": "uuid",
   "offers": [{ "ofertaId": "uuid", "cafeteriaId": "uuid", "cafeteriaNombre": "Cafetería Central",
                "precio": 1800, "stock": 4, "disponible": true }] }]

// GET /v1/catalog/productos/{id}?campusId=uuid -> el mismo Producto, con las ofertas del campus
```

Cuatro puntos que la app necesita y que hoy no existen:

- **`offers` anidadas en el producto, acotadas al campus consultado.** En el backend `Offer`
  tiene la FK `product_id` y la FK `cafeteria_id`; el DTO tiene que agruparlas y devolver
  **solo las de las cafeterías de ese campus**. Es el punto que más conviene cerrar: si el
  listado trae ofertas de otras sedes, el cliente vería precios a los que no puede retirar.
  `disponible` se deriva de `OfferStatus` y de `stock > 0`.
- **Un campus tiene N cafeterías, no una.** El modelo ya lo define así (`Campus.caferias` es
  un `@OneToMany`), por eso el DTO del campus expone `cafeterias[]` y no un `cafeteriaId`
  único: cada punto de retiro cobra su propio precio y la app los lista todos. Un campus con
  una sola cafetería sigue funcionando, y es el caso de prueba más simple.
- **`categoriaId` plano**, extraído de `Product.category.id`. La pantalla de detalle (INT4-30)
  lo cruza con `/categorias` para mostrar el nombre en la pastilla.
- **Los DTOs en español** (`nombre`, `direccion`, `precio`), no los nombres de la entidad.

El precio nunca sale del producto: `Producto` no lo tiene. Y la dirección que muestra el
detalle de cada oferta es la del **campus**, porque `Cafeteria` no tiene dirección propia en el
modelo: todas las cafeterías de una sede comparten la dirección del campus.

`categoriaId` es opcional: sin él la app manda solo `campusId` y el backend devuelve todo el
catálogo del campus. `/v1/catalog/productos` (y su detalle `/productos/{id}`, INT4-30) no está
en la lista pública del gateway, así que requiere sesión iniciada; `/campus` y `/categorias`
son públicas (INT2-33).

## Notas

- **Rutas centralizadas**: cada dominio define una única constante de ruta en su servicio
  (`COMPRAS_ENDPOINT`, `ORDENES_ENDPOINT`, `SEGUIMIENTOS_ENDPOINT`, `PERFIL_ENDPOINT`, …).
  Si el equipo de backend negocia otra ruta distinta, se ajusta la constante en un solo lugar,
  sin tocar pantallas.
- **Tiempo real**: solo el seguimiento de orden en vivo (fila 8) usa WebSocket. El resto de
  pantallas refrescan al ganar foco (`useFocusEffect`). En particular "Mis Compras" (fila 10)
  recarga cada vez que se entra al tab; si se quiere actualización push _estando dentro_ del
  tab, habría que suscribirse a un topic de compras (p. ej. `/topic/compras/{id}/estado`),
  reutilizando el patrón de la fila 8.
- **Guard vs backend**: mientras un controller no exista, el gateway responde 404/405 y todas
  estas pantallas muestran el error normalizado — no crashean ni muestran datos falsos.
