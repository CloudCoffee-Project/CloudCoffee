package cl.cloudcoffee.order_service.dto;

import java.util.List;
import org.springframework.data.domain.Page;
import cl.cloudcoffee.order_service.model.Compra;

/** Forma estable de INT2-50, independiente de la serialización interna de Spring Page. */
public record PaginaComprasResponse(List<CompraResponse> content, int number, int size, long totalElements,
        int totalPages, boolean first, boolean last, boolean empty) {
    public static PaginaComprasResponse from(Page<Compra> pagina, List<CompraResponse> content) {
        return new PaginaComprasResponse(List.copyOf(content), pagina.getNumber(), pagina.getSize(),
                pagina.getTotalElements(), pagina.getTotalPages(), pagina.isFirst(),
                (long) pagina.getNumber() + 1 >= pagina.getTotalPages(), content.isEmpty());
    }
}
