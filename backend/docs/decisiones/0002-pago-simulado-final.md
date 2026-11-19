# 0002 - Pago simulado como alcance final

Estado: decisión histórica del 18-11-2026, sustituida para la web el 19-11-2026.
El flujo web vigente usa [Checkout Pro Sandbox](../payment-service.md) según INT2-61.
El simulador sigue disponible para pruebas internas.

El flujo final de web y móvil usa el simulador existente de Order. Se configura
`ORDER_PAYMENT_PROVIDER=simulado` y `PAYMENT_PROVIDER=disabled`. El contrato de
compra/pago/retiro 1.0 conserva los escenarios `aprobar`, `rechazar` y `pendiente`.
No se requieren credenciales, preferencias, initPoint, navegador de pago,
retornos externos ni webhooks de Mercado Pago para ejecutar o aceptar el sistema.

El cliente envía solo el escenario y un UUID estable por intención. Order calcula
montos, autoriza al propietario y aplica confirmación/liberación de stock. El
cliente consulta el resultado y nunca acredita pagos con parámetros de URL.
Los reintentos conservan escenario y clave; una compra mantiene un único pago.
La simulación y la ausencia de cobros reales se indican en las pantallas.

La decisión 0001 y el módulo Payment ya implementado quedan como historial de
arquitectura, fuera de la dependencia del recorrido final. No se eliminan datos,
migraciones, pruebas ni estados históricos por este cambio. Las tareas pendientes
de integración, pruebas y documentación se actualizan al alcance simulado.

El QR sigue dependiendo del estado autorizado por Order y de su implementación
de retiro; simular una aprobación no equivale a marcar una orden lista.
