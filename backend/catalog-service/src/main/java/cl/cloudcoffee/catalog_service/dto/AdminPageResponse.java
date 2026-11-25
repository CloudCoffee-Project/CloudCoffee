package cl.cloudcoffee.catalog_service.dto;

import java.util.List;

import org.springframework.data.domain.Page;

public record AdminPageResponse<T>(List<T> content, int number, int size, long totalElements, int totalPages,
        boolean first, boolean last, boolean empty) {
    public static <T> AdminPageResponse<T> from(Page<T> page) {
        return new AdminPageResponse<>(page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements(),
                page.getTotalPages(), page.isFirst(), page.isLast(), page.isEmpty());
    }
}
