package cl.cloudcoffee.catalog_service.service;

import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.CafeteriaInventoryItemResponse;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;

@Service
@Transactional(readOnly = true)
public class CafeteriaInventoryService {

    private final OfferRepository offerRepository;

    public CafeteriaInventoryService(OfferRepository offerRepository) {
        this.offerRepository = offerRepository;
    }

    public Page<CafeteriaInventoryItemResponse> findInventory(UUID cafeteriaId, Boolean activa, Pageable pageable) {
        Pageable safe = PageRequest.of(Math.max(0, pageable.getPageNumber()),
                Math.max(1, Math.min(100, pageable.getPageSize())));
        return offerRepository.findInventoryByCafeteria(cafeteriaId, activa, safe)
                .map(CafeteriaInventoryItemResponse::from);
    }
}
