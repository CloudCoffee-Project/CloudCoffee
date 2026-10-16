package cl.cloudcoffee.catalog_service.service;

import java.util.List;
import java.util.UUID;

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

    public List<CafeteriaInventoryItemResponse> findInventory(UUID cafeteriaId) {
        return offerRepository.findInventoryByCafeteria(cafeteriaId).stream()
                .map(CafeteriaInventoryItemResponse::from)
                .toList();
    }
}
