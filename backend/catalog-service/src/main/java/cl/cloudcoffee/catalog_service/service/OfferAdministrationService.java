package cl.cloudcoffee.catalog_service.service;

import java.math.BigDecimal;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.CrearOfertaRequest;
import cl.cloudcoffee.catalog_service.dto.EditarOfertaRequest;
import cl.cloudcoffee.catalog_service.dto.OfertaAdminResponse;
import cl.cloudcoffee.catalog_service.model.entity.CatalogAudit;
import cl.cloudcoffee.catalog_service.model.entity.CatalogIdempotency;
import cl.cloudcoffee.catalog_service.model.entity.Cafeteria;
import cl.cloudcoffee.catalog_service.model.entity.Offer;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import cl.cloudcoffee.catalog_service.model.enums.OfferStatus;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;
import cl.cloudcoffee.catalog_service.model.enums.StockReservationStatus;
import cl.cloudcoffee.catalog_service.repository.CatalogAuditRepository;
import cl.cloudcoffee.catalog_service.repository.CatalogIdempotencyRepository;
import cl.cloudcoffee.catalog_service.repository.CafeteriaRepository;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.ProductRepository;
import cl.cloudcoffee.catalog_service.repository.StockReservationRepository;
import cl.cloudcoffee.errors.BusinessException;
import cl.cloudcoffee.security.CafeteriaAccess;
import tools.jackson.databind.json.JsonMapper;

@Service
@Transactional
public class OfferAdministrationService {
    private static final String RESOURCE = "OFERTA";

    private final OfferRepository offers;
    private final ProductRepository products;
    private final CafeteriaRepository cafeterias;
    private final CatalogAuditRepository audits;
    private final CatalogIdempotencyRepository idempotencies;
    private final StockReservationRepository reservations;
    private final CafeteriaAccess cafeteriaAccess;
    private final JsonMapper json;
    private final Clock clock;

    public OfferAdministrationService(OfferRepository offers, ProductRepository products,
            CafeteriaRepository cafeterias, CatalogAuditRepository audits,
            CatalogIdempotencyRepository idempotencies, StockReservationRepository reservations,
            CafeteriaAccess cafeteriaAccess, JsonMapper json, Clock clock) {
        this.offers = offers;
        this.products = products;
        this.cafeterias = cafeterias;
        this.audits = audits;
        this.idempotencies = idempotencies;
        this.reservations = reservations;
        this.cafeteriaAccess = cafeteriaAccess;
        this.json = json;
        this.clock = clock;
    }

    public Creation crear(UUID cafeteriaId, CrearOfertaRequest request, UUID idempotencyKey,
            Authentication authentication) {
        requireAdmin(authentication, cafeteriaId, cafeteriaAccess);
        String hash = fingerprint(cafeteriaId.toString(), request.productoId().toString(),
                request.precio().toString(), request.stockInicial().toString());
        OfertaAdminResponse replay = replay(authentication, idempotencyKey, hash);
        if (replay != null) return new Creation(replay, true);

        Cafeteria cafeteria = cafeterias.findById(cafeteriaId)
                .orElseThrow(() -> notFound("Cafetería no encontrada"));
        if (!cafeteria.isActive() || cafeteria.getStatus() != CafeteriaStatus.OPEN) {
            throw conflict("La cafetería no está operativa", "CAFETERIA_INACTIVA");
        }
        Product product = products.findById(request.productoId())
                .orElseThrow(() -> notFound("Producto no encontrado"));
        if (product.getStatus() != ProductStatus.ACTIVE || !product.getCategory().isActive()) {
            throw conflict("El producto no está activo", "PRODUCTO_INACTIVO");
        }
        if (offers.existsOffer(cafeteriaId, product.getId())) {
            throw conflict("Ya existe una relación cafetería-producto", "OFERTA_EXISTENTE");
        }

        Offer offer = new Offer();
        offer.setCafeteria(cafeteria);
        offer.setProduct(product);
        offer.setPrice(BigDecimal.valueOf(request.precio()));
        offer.setStock(request.stockInicial());
        offer.setStatus(request.stockInicial() == 0 ? OfferStatus.OUT_OF_STOCK : OfferStatus.AVAILABLE);
        offer.setAdministrativeActive(true);
        offer.setBajaAt(null);
        offer.setVersion(1L);
        offer = offers.saveAndFlush(offer);
        OfertaAdminResponse response = OfertaAdminResponse.from(offer);
        audit(offer.getId(), "CREAR", authentication, "Oferta creada");
        remember(authentication, idempotencyKey, hash, offer.getId(), response);
        return new Creation(response, false);
    }

    public OfertaAdminResponse editar(UUID cafeteriaId, UUID ofertaId, EditarOfertaRequest request,
            Authentication authentication) {
        requireAdmin(authentication, cafeteriaId, cafeteriaAccess);
        Offer offer = offers.findForUpdateInCafeteria(ofertaId, cafeteriaId)
                .orElseThrow(() -> notFound("Oferta no encontrada"));
        if (offer.getProduct().getStatus() != ProductStatus.ACTIVE
                || !offer.getProduct().getCategory().isActive()) {
            throw conflict("El producto no está activo", "PRODUCTO_INACTIVO");
        }
        if (offer.getVersion() == null || !offer.getVersion().equals(request.version())) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
        BigDecimal previous = offer.getPrice();
        BigDecimal next = BigDecimal.valueOf(request.precio());
        if (previous.compareTo(next) != 0) {
            offer.setPrice(next);
            offer = save(offer);
            boolean hasActiveOrders = reservations.existsByOfferIdAndStatusIn(ofertaId,
                    List.of(StockReservationStatus.RESERVED, StockReservationStatus.CONFIRMED));
            audit(offer.getId(), "EDITAR_PRECIO", authentication,
                    hasActiveOrders ? "Precio cambiado; reservas/órdenes activas conservan el snapshot"
                            : "Precio cambiado");
        }
        return OfertaAdminResponse.from(offer);
    }

    public OfertaAdminResponse baja(UUID cafeteriaId, UUID ofertaId, Authentication authentication) {
        requireAdmin(authentication, cafeteriaId, cafeteriaAccess);
        Offer offer = offers.findForUpdateInCafeteria(ofertaId, cafeteriaId)
                .orElseThrow(() -> notFound("Oferta no encontrada"));
        if (offer.isAdministrativeActive()) {
            offer.setAdministrativeActive(false);
            offer.setBajaAt(clock.instant());
            offer = save(offer);
            audit(ofertaId, "BAJA", authentication,
                    "Baja administrativa; stock, reservas y snapshots se preservan");
        }
        return OfertaAdminResponse.from(offer);
    }

    public OfertaAdminResponse reactivar(UUID cafeteriaId, UUID ofertaId, Authentication authentication) {
        requireAdmin(authentication, cafeteriaId, cafeteriaAccess);
        Offer offer = offers.findForUpdateInCafeteria(ofertaId, cafeteriaId)
                .orElseThrow(() -> notFound("Oferta no encontrada"));
        if (offer.getProduct().getStatus() != ProductStatus.ACTIVE
                || !offer.getProduct().getCategory().isActive()) {
            throw conflict("El producto no está activo", "PRODUCTO_INACTIVO");
        }
        if (!offer.isAdministrativeActive()) {
            offer.setAdministrativeActive(true);
            offer.setBajaAt(null);
            offer.setStatus(offer.getStock() == 0 ? OfferStatus.OUT_OF_STOCK : OfferStatus.AVAILABLE);
            offer = save(offer);
            audit(ofertaId, "REACTIVAR", authentication, "Oferta reactivada sin alterar el stock");
        }
        return OfertaAdminResponse.from(offer);
    }

    private OfertaAdminResponse replay(Authentication authentication, UUID key, String hash) {
        var previous = idempotencies.findByResourceTypeAndActorIdAndIdempotencyKey(
                RESOURCE, authentication.getName(), key);
        if (previous.isEmpty()) return null;
        CatalogIdempotency record = previous.get();
        if (!record.getRequestHash().equals(hash)) {
            throw conflict("La Idempotency-Key ya se usó con una solicitud distinta", "IDEMPOTENCY_CONFLICT");
        }
        return json.readValue(record.getResponseBody(), OfertaAdminResponse.class);
    }

    private void remember(Authentication authentication, UUID key, String hash, UUID resourceId,
            OfertaAdminResponse response) {
        CatalogIdempotency record = new CatalogIdempotency();
        record.setResourceType(RESOURCE);
        record.setActorId(authentication.getName());
        record.setIdempotencyKey(key);
        record.setRequestHash(hash);
        record.setResourceId(resourceId);
        record.setResponseBody(json.writeValueAsString(response));
        idempotencies.saveAndFlush(record);
    }

    private void audit(UUID resourceId, String action, Authentication authentication, String detail) {
        CatalogAudit audit = new CatalogAudit();
        audit.setResourceType(RESOURCE);
        audit.setResourceId(resourceId);
        audit.setAction(action);
        audit.setActorId(authentication.getName());
        audit.setDetail(detail);
        audit.setCreatedAt(clock.instant());
        audits.save(audit);
    }

    private Offer save(Offer offer) {
        try {
            return offers.saveAndFlush(offer);
        } catch (OptimisticLockingFailureException exception) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
    }

    private static void requireAdmin(Authentication authentication, UUID cafeteriaId, CafeteriaAccess cafeteriaAccess) {
        if (!(authentication instanceof JwtAuthenticationToken token)
                || !"ADMIN_CAFETERIA".equals(token.getToken().getClaimAsString("role"))) {
            throw new AccessDeniedException("Solo ADMIN_CAFETERIA puede administrar ofertas.");
        }
        cafeteriaAccess.verificar(authentication, cafeteriaId);
    }

    private static String fingerprint(String... parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String part : parts) {
                digest.update((part == null ? "\u0000" : part).getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0x1f);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required", exception);
        }
    }

    private static BusinessException conflict(String detail, String code) {
        return new BusinessException(HttpStatus.CONFLICT, URI.create("/problems/" + code.toLowerCase().replace('_', '-')),
                "Conflicto", detail, code);
    }

    private static BusinessException notFound(String detail) {
        return new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/recurso-no-encontrado"),
                "Recurso no encontrado", detail);
    }

    public record Creation(OfertaAdminResponse response, boolean replayed) {}
}
