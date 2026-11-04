package cl.cloudcoffee.catalog_service.controller;

import cl.cloudcoffee.catalog_service.dto.OfertaCompraResponse;
import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.errors.BusinessException;
import java.net.URI;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/servicios/catalogo/cotizaciones")
public class InternalPurchaseCatalogController {
    private final OfferRepository ofertas;

    public InternalPurchaseCatalogController(OfferRepository ofertas) { this.ofertas = ofertas; }

    @PostMapping
    @Transactional(readOnly = true)
    public List<OfertaCompraResponse> cotizar(@RequestBody List<UUID> ids) {
        if (ids == null || ids.isEmpty() || ids.size() > 100 || ids.stream().anyMatch(java.util.Objects::isNull)
                || new HashSet<>(ids).size() != ids.size()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/solicitud-invalida"),
                    "Solicitud inválida", "Se requieren entre 1 y 100 ofertas distintas.", "SOLICITUD_INVALIDA");
        }
        var resultado = ofertas.findAllById(ids);
        // OUT_OF_STOCK sigue siendo una oferta válida para cotizar: dará revisión al reservar.
        if (resultado.size() != ids.size() || resultado.stream().anyMatch(o ->
                o.getProduct().getStatus() != ProductStatus.ACTIVE
                || o.getCafeteria().getStatus() != CafeteriaStatus.OPEN)
                || resultado.stream().map(o -> o.getCafeteria().getCampus().getId()).distinct().count() != 1) {
            throw new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/oferta-no-disponible"),
                    "Oferta no disponible", "Las ofertas deben estar activas y pertenecer al mismo campus.",
                    "OFERTA_NO_DISPONIBLE");
        }
        return resultado.stream().map(OfertaCompraResponse::from).toList();
    }
}
