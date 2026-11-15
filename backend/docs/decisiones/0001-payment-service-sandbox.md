# ADR 0001 · Payment independiente y Mercado Pago sandbox

Estado: aceptada como contrato objetivo de Sprint 3 (INT2-108).

## Contexto y decisión anterior

INT2-50 eligió un simulador dentro de Order. Su contrato 1.0.0, ejemplos y
migraciones permanecen en `compra-pago-retiro.*`; describen el comportamiento
anterior y permiten reproducir las pruebas existentes. No se reescribe esa decisión.
La ampliación de Sprint 3 requiere Checkout Pro de Mercado Pago en sandbox.

## Decisión

Crear `payment-service` con PostgreSQL propio. Payment posee la intención,
preferencia, correlación con el proveedor, recepción de notificaciones y outbox.
Order posee compras, órdenes, reservas, autorización del comprador y la proyección
de pago que habilita preparación/retiro. Catalog sigue siendo dueño del stock.
No existen claves foráneas, joins ni transacciones entre bases de servicios.

El contrato objetivo 2.0.0 está en [payment-service.md](../payment-service.md)
y [payment-service.openapi.json](../payment-service.openapi.json). La versión del
documento cambia; el prefijo público continúa siendo `/v1`. El cambio del comando
de pago se despliega coordinadamente con los clientes y con INT2-111/112/113/61.
La publicación del documento o del módulo base no activa pagos externos.

Order invoca una API interna autenticada de Payment. El navegador recibe un
`initPoint` y consulta a Order; nunca informa importes definitivos ni acredita un
pago. Payment consulta a Mercado Pago y publica hechos versionados por RabbitMQ.
Order aplica esos hechos mediante su recuperación durable de reservas existente.

## Consecuencias

* Una compra multi cafetería tiene un solo total congelado, una intención Payment
  y una preferencia; el alcance sandbox no distribuye fondos entre cafeterías.
* Entrega de eventos al menos una vez: inbox/outbox y consumidores idempotentes.
* Resultado externo y cumplimiento de compra son estados distintos. Una aprobación
  tardía sin reservas confirmables exige conciliación; nunca habilita retiro.
* La incertidumbre después de un POST al proveedor no autoriza repetirlo a ciegas.
  Se mantiene la intención y se reconcilia antes de crear otro recurso.
* El proveedor simulado permanece aislado para desarrollo/pruebas. No hay fallback
  automático al simulador ni comandos `escenario` en el flujo sandbox.
* Las credenciales y firmas quedan en backend. No se almacenan datos de tarjeta.

## Entregas

INT2-108 define contratos y ejemplos; INT2-110 entrega módulo, esquema y despliegue.
INT2-111 implementa preferencias; INT2-112 firmas, conciliación y eventos;
INT2-113 integra Order; INT2-61 integra el checkout web. Las pruebas integradas
pertenecen a INT2-82/83/87 y el pipeline compartido a INT2-103.
