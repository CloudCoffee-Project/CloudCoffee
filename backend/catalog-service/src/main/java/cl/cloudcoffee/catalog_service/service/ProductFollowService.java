package cl.cloudcoffee.catalog_service.service;

import java.net.URI;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import cl.cloudcoffee.catalog_service.dto.SeguimientoResponse;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.entity.ProductFollow;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;
import cl.cloudcoffee.catalog_service.repository.CafeteriaRepository;
import cl.cloudcoffee.catalog_service.repository.OfferRepository;
import cl.cloudcoffee.catalog_service.repository.ProductFollowRepository;
import cl.cloudcoffee.catalog_service.repository.ProductRepository;
import cl.cloudcoffee.errors.BusinessException;

/** INT2-116: seguimientos de productos del cliente para avisos de reposición. */
@Service
public class ProductFollowService {

    private final ProductFollowRepository follows;
    private final ProductRepository products;
    private final CafeteriaRepository cafeterias;
    private final OfferRepository offers;
    private final Clock clock;
    private final TransactionTemplate tx;

    public ProductFollowService(ProductFollowRepository follows, ProductRepository products,
            CafeteriaRepository cafeterias, OfferRepository offers, Clock clock, PlatformTransactionManager manager) {
        this.follows = follows;
        this.products = products;
        this.cafeterias = cafeterias;
        this.offers = offers;
        this.clock = clock;
        this.tx = new TransactionTemplate(manager);
    }

    /** {@code creado} es false cuando el seguimiento ya existía y estaba activo. */
    public record Resultado(SeguimientoResponse seguimiento, boolean creado) {
    }

    public Resultado seguir(UUID usuarioId, UUID productoId, UUID cafeteriaId) {
        if (productoId == null) {
            throw error(HttpStatus.BAD_REQUEST, "Solicitud inválida", "productoId es obligatorio.", "SOLICITUD_INVALIDA");
        }
        try {
            return tx.execute(status -> crearOReactivar(usuarioId, productoId, cafeteriaId));
        } catch (DataIntegrityViolationException carrera) {
            // Otra solicitud creó el mismo seguimiento en paralelo: se devuelve ese, sin duplicar.
            return tx.execute(status -> new Resultado(SeguimientoResponse.from(follows
                    .findByClave(usuarioId, productoId, ProductFollow.claveDe(cafeteriaId)).orElseThrow(() -> carrera)),
                    false));
        }
    }

    private Resultado crearOReactivar(UUID usuarioId, UUID productoId, UUID cafeteriaId) {
        Product producto = products.findById(productoId).orElseThrow(() -> error(HttpStatus.NOT_FOUND,
                "Producto no encontrado", "No existe un producto con el identificador indicado.", "PRODUCTO_NO_ENCONTRADO"));
        if (producto.getStatus() != ProductStatus.ACTIVE) {
            throw error(HttpStatus.CONFLICT, "Producto inactivo", "El producto no está activo en el catálogo.",
                    "PRODUCTO_INACTIVO");
        }
        // Un seguimiento puntual exige que esa cafetería ofrezca el producto. Se permite aunque esté agotado:
        // es justamente el caso que el aviso de reposición cubre.
        var cafeteria = cafeteriaId == null ? null : cafeterias.findById(cafeteriaId).orElse(null);
        if (cafeteriaId != null && (cafeteria == null || !offers.existsOffer(cafeteriaId, productoId))) {
            throw error(HttpStatus.NOT_FOUND, "Oferta no encontrada",
                    "La cafetería indicada no ofrece este producto.", "OFERTA_NO_ENCONTRADA");
        }

        var existente = follows.findForUpdate(usuarioId, productoId, ProductFollow.claveDe(cafeteriaId));
        if (existente.isPresent() && existente.get().activo()) {
            return new Resultado(SeguimientoResponse.from(existente.get()), false);
        }
        ProductFollow follow = existente.orElseGet(() -> {
            ProductFollow nuevo = new ProductFollow();
            nuevo.setUserId(usuarioId);
            nuevo.setProduct(producto);
            nuevo.setCafeteria(cafeteria);
            nuevo.setCafeteriaKey(ProductFollow.claveDe(cafeteriaId));
            return nuevo;
        });
        // Volver a seguir reactiva la fila dada de baja: el alta vuelve a contar desde ahora.
        follow.setDeletedAt(null);
        follow.setCreatedAt(clock.instant().truncatedTo(ChronoUnit.MICROS));
        return new Resultado(SeguimientoResponse.from(follows.saveAndFlush(follow)), true);
    }

    public Page<SeguimientoResponse> listar(UUID usuarioId, int page, int size) {
        return tx.execute(status -> follows.findActivosDe(usuarioId, PageRequest.of(page, size))
                .map(SeguimientoResponse::from));
    }

    /** Idempotente para el dueño; un seguimiento ajeno o inexistente responde 404 sin revelar cuál es el caso. */
    public void dejarDeSeguir(UUID usuarioId, UUID seguimientoId) {
        tx.executeWithoutResult(status -> {
            ProductFollow follow = follows.findByIdAndUserId(seguimientoId, usuarioId)
                    .orElseThrow(() -> error(HttpStatus.NOT_FOUND, "Seguimiento no encontrado",
                            "No existe un seguimiento con el identificador indicado.", "SEGUIMIENTO_NO_ENCONTRADO"));
            if (follow.activo()) {
                follow.setDeletedAt(clock.instant().truncatedTo(ChronoUnit.MICROS));
            }
        });
    }

    private static BusinessException error(HttpStatus status, String title, String detail, String code) {
        return new BusinessException(status, URI.create("/problems/" + code.toLowerCase().replace('_', '-')),
                title, detail, code);
    }
}
