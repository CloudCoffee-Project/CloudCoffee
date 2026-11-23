# Comprobantes internos por orden (INT2-128)

`GET /v1/orders/{ordenId}/boleta` requiere el JWT del CLIENTE propietario.
Gateway elimina `/v1` y conserva cuerpo y cabeceras. Responde `application/pdf`,
`Content-Disposition: attachment; filename="comprobante-CC-<ordenId>.pdf"` y
`Cache-Control: no-store`. Orden ajena o inexistente: 404; rol ajeno: 403;
pago sin confirmar/conciliación o estado de orden incompatible: 409
`COMPROBANTE_NO_DISPONIBLE`. Los errores usan Problem Details, aun al pedir PDF.

El folio se deriva del UUID inmutable de la orden (`CC-<ordenId>`), sin contador,
mutación al descargar ni nuevo folio ante concurrencia. Una compra con varias
cafeterías tiene un PDF separado por orden. La fecha es la de creación de la
orden, identificada como fecha de compra y presentada en America/Santiago.
Nombre de cafetería y productos, cantidades, precios y total proceden solo de
los snapshots de Order; no hay consultas a servicios externos. El documento
no contiene datos personales del comprador, referencias de pago ni QR/tokens.

Se exige pago APROBADO, compra PAGADO y orden pagada o en una fase posterior de
retiro. No basta un retorno aprobado del navegador ni un pago aún confirmando
stock. El comprobante indica su carácter interno y falta de validez tributaria;
no integra SII. No requiere cambios de base ni almacenamiento adicional.

PDFBox 3.0.8 genera A4 con fuente DejaVu Sans incrustada (licencia incluida),
precios CLP, nombres largos ajustados, cabeceras repetidas y páginas numeradas.
Los glifos que no existen en la fuente se representan con `?`. Las pruebas HTTP
cubren permisos y JWT, pago pendiente, folio/lecturas repetidas, multicafetería y
100 ítems largos. Generan PDF y PNG de muestra en `order-service/target/` para
revisar legibilidad sin agregar artefactos de prueba al repositorio.
