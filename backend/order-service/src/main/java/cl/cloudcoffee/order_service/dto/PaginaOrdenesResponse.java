package cl.cloudcoffee.order_service.dto;

import cl.cloudcoffee.order_service.model.Orden;
import java.util.List;
import org.springframework.data.domain.Page;

/** Forma estable del contrato INT2-50 para los pedidos del cajero. */
public record PaginaOrdenesResponse(List<OrdenResponse> content, int number, int size, long totalElements,
        int totalPages, boolean first, boolean last, boolean empty) {
    public static PaginaOrdenesResponse from(Page<Orden> pagina, List<OrdenResponse> content) {
        return new PaginaOrdenesResponse(List.copyOf(content), pagina.getNumber(), pagina.getSize(),
                pagina.getTotalElements(), pagina.getTotalPages(), pagina.isFirst(),
                (long) pagina.getNumber() + 1 >= pagina.getTotalPages(), content.isEmpty());
    }
}
