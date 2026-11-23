package cl.cloudcoffee.order_service.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public record ResumenVentasResponse(LocalDate desde, LocalDate hasta, String moneda, long ordenes, long montoTotal,
        List<PorEstado> porEstado, List<PorCafeteria> porCafeteria) {
    public record PorEstado(String estado, long ordenes, long montoTotal) {}

    public record PorCafeteria(UUID cafeteriaId, String cafeteriaNombre, long ordenes, long montoTotal) {}
}
