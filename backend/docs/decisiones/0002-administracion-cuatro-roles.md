# ADR 0002 · Administración y permisos de los cuatro roles

Estado: propuesta como contrato objetivo de Sprint 3 (INT2-109).

## Contexto

Auth ya persiste los roles `CLIENTE`, `CAJERO`, `ADMIN_CAFETERIA` y `SUPER_ADMIN`
y la asignación del personal a una cafetería (INT2-65). `common-security` ofrece
`CafeteriaAccess` y `AsignacionesCafeteria`, que consultan esa asignación en Auth en
cada solicitud y fallan cerrado. No existen APIs ni pantallas de administración:
el diagrama de casos de uso las contempla, pero no tienen contrato.

## Decisión

Publicar el contrato 1.0.0 en [administracion.md](../administracion.md), con
[OpenAPI](../administracion.openapi.json) y [eventos](../administracion.eventos.json).
Cada servicio sigue siendo dueño de sus datos: Auth administra cuentas y
asignaciones, Catalog administra campus, cafeterías, categorías, productos, ofertas
y stock, y Order expone ventas y comprobantes. No hay FK ni joins entre bases.

1. **La autorización del personal sale de la asignación persistida**, nunca del
   claim `cafeteriaId` del JWT, que sigue siendo solo dato de UI.
2. **`SUPER_ADMIN` administra la plataforma, pero no opera cafeterías.** No ajusta
   stock, no cambia el estado operativo ni atiende pedidos. Esta regla fue
   confirmada por el solicitante para el stock y se extiende al resto de la
   operación diaria para que el modelo sea uniforme.
3. **`CAJERO` y `ADMIN_CAFETERIA` ajustan stock solo de su cafetería asignada**, con
   un registro auditado por ajuste en vez de escribir el stock directamente.
4. **El personal se crea por invitación.** Nadie fija ni comparte contraseñas: la
   persona invitada define la suya con un token de un solo uso. El registro público
   siempre crea `CLIENTE`; no existe cambio de rol ni creación de `SUPER_ADMIN` por API.
5. **Baja lógica y cierre operativo son conceptos distintos.** El cierre (`OPEN`,
   `CLOSED`, `MAINTENANCE`) es temporal y lo decide la cafetería; la baja retira el
   recurso de la venta y solo la revierte quien la hizo.
6. **La baja de una cuenta la anonimiza y conserva las compras**, que en Order solo
   referencian el `usuarioId` y no guardan datos personales.

## Consecuencias

* Cada operación de personal agrega una consulta interna a Auth. Se acepta, igual
  que en INT2-65/78: revocar una asignación rige en la siguiente solicitud.
* Una cuenta `SUPER_ADMIN` desactivada conserva su access token hasta 15 minutos
  en los servicios que no son Auth. Las operaciones de Auth sí revisan el estado
  de la cuenta en cada solicitud. Se acepta por el TTL corto del token.
* Las implementaciones requieren cambios de esquema (ver «Cambios de esquema
  previstos» en el contrato) y dos endpoints internos nuevos.
* El comprobante interno no reemplaza una boleta tributaria; la boleta electrónica
  queda fuera de alcance.

## Entregas

INT2-109 define el contrato, los ejemplos y el validador
(`python scripts/validate-admin-contract.py`). Las issues de implementación de
Sprint 3 construyen las APIs y pantallas de administración sobre este contrato.
