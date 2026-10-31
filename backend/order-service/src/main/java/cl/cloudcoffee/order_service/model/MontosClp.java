package cl.cloudcoffee.order_service.model;

import java.math.BigDecimal;

/** Límites comunes a compra, orden e ítem; nunca redondear pesos del catálogo. */
final class MontosClp {
    private static final BigDecimal MAXIMO = new BigDecimal("2000000000");

    private MontosClp() {}

    static BigDecimal validar(BigDecimal monto) {
        if (monto == null || monto.signum() < 0 || monto.compareTo(MAXIMO) > 0
                || monto.stripTrailingZeros().scale() > 0) {
            throw new IllegalArgumentException("El importe debe ser un entero entre 0 y 2000000000 CLP");
        }
        return monto;
    }
}
