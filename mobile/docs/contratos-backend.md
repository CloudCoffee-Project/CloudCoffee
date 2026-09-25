# Contratos backend vs app móvil

Matriz de dependencias entre los servicios que consume la app móvil (`mobile/src/services/*`)
y el estado del backend. Objetivo: saber qué funciona hoy, qué queda listo para cuando el
backend implemente el controller, y qué requiere algo más que un endpoint REST.

Regla general: **la app nunca mockea en producción**. Todos los servicios usan el
`httpClient` del gateway; si el servidor responde con `problem+json`, la pantalla muestra el
error normalizado (`toApiError`) con botón de reintentar. Cuando el backend implemente su
lado, estas pantallas funcionan **sin cambios en la app**.

| #   | Dominio / feature (issue)                                           | Endpoint(s) que consume la app                                        | Estado                                | Dependencia backend                                                                               |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Catálogo, campus, cafeterías, ofertas y stock (INT4-26…33)          | `GET /v1/catalog/**`                                                  | ✅ Funciona hoy                       | Catalog-service + gateway (`/v1/catalog/**` ruteado)                                              |
| 2   | Autenticación: login, registro, verificación de correo (INT4-19…22) | `POST /v1/auth/login` · `/register` · `/verificacion` (+ `/reenviar`) | ✅ Funciona hoy                       | Auth-service + gateway (`/v1/auth/**` ruteado)                                                    |
| 3   | Recuperar / restablecer contraseña (INT4-25)                        | `POST /v1/auth/password/recovery` · `/reset`                          | ✅ Funciona hoy                       | Auth-service (mismos `/v1/auth/**`)                                                               |
| 4   | Perfil: ver y editar datos (INT4-23/24)                             | `GET / PUT /v1/auth/me`                                               | ⏳ Listo, backend pendiente           | Auth-service debe implementar `/me`                                                               |
| 5   | Notificaciones push: banner y bandeja (INT4-46/47)                  | `POST/DELETE /v1/notifications/device-token`                          | ✅ Funciona hoy                       | Notification-service + gateway (`/v1/notifications/**` ruteado)                                   |
| 6   | Carrito y pago con Mercado Pago (INT4-32…37, Integración II)        | `POST /v1/compras` + checkout MP                                      | 🧪 **Mock temporal en `carrito.tsx`** | Order/payment-service; al existir `POST /v1/compras`, se reemplaza el mock por `crearCompra` real |
| 7   | Seguimientos de productos (INT4-45/53)                              | `GET/POST/DELETE /v1/catalog/seguimientos`                            | ⏳ Listo, backend pendiente           | Catalog-service debe exponer `/seguimientos` (doc: "solo app móvil")                              |
| 8   | Seguimiento de orden en vivo (INT4-44)                              | WebSocket STOMP `/topic/orden/{id}/estado`                            | 📡 Listo, requiere WS del backend     | Backend debe publicar el topic y el endpoint de suscripción                                       |
| 9   | Boleta en PDF de una orden (INT4-48)                                | `GET /v1/orders/{id}/boleta`                                          | ⏳ Listo, backend pendiente           | Order-service + gateway debe routear `/v1/orders/**`                                              |
| 10  | Historial de compras (INT4-50)                                      | `GET /v1/compras`                                                     | ⏳ Listo, backend pendiente           | Order-service + gateway debe routear `/v1/compras`                                                |
| 11  | Cajero: pedidos entrantes (INT4-7)                                  | `GET /v1/orders`                                                      | ⏳ Listo, backend pendiente           | Order-service + gateway (`/v1/orders/**`)                                                         |
| 12  | Cajero: confirmar entrega por QR (INT4-8)                           | `POST /v1/orders/{id}/entregar`                                       | ⏳ Listo, backend pendiente           | Ídem                                                                                              |
| 13  | Cajero: rescatar orden no retirada (INT4-12)                        | `POST /v1/orders/{id}/no-retirado/revisar`                            | ⏳ Listo, backend pendiente           | Ídem                                                                                              |

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
