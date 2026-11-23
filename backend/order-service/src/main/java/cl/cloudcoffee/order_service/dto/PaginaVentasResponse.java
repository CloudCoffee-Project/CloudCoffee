package cl.cloudcoffee.order_service.dto;

import java.util.List;
import org.springframework.data.domain.Page;

public record PaginaVentasResponse(List<VentaResponse> content, int number, int size, long totalElements,
        int totalPages, boolean first, boolean last, boolean empty) {
    public static PaginaVentasResponse from(Page<VentaResponse> pagina) {
        return new PaginaVentasResponse(pagina.getContent(), pagina.getNumber(), pagina.getSize(),
                pagina.getTotalElements(), pagina.getTotalPages(), pagina.isFirst(), pagina.isLast(), pagina.isEmpty());
    }
}
