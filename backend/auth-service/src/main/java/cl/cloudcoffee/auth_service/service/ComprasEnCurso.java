package cl.cloudcoffee.auth_service.service;

import java.util.UUID;

/**
 * Consulta interna a Order ({@code GET /internal/servicios/compras/usuarios/{id}/en-curso}) antes de dar de
 * baja una cuenta CLIENTE (INT2-129), sin leer tablas de Order.
 */
public interface ComprasEnCurso {

    /**
     * @return cuántas compras del usuario siguen sin cerrar (revisión, pago pendiente o en conciliación, u
     *         órdenes pagadas aún no entregadas ni cerradas).
     * @throws OperacionPendienteException si Order no responde o su respuesta no es verificable.
     */
    long contar(UUID usuarioId);
}
