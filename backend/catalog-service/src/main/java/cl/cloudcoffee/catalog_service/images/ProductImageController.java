package cl.cloudcoffee.catalog_service.images;

import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.repository.ProductRepository;
import cl.cloudcoffee.errors.BusinessException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import java.net.URI;
import java.time.Duration;
import java.util.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.*;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class ProductImageController {
    private final ProductRepository products;
    private final ProductImageStorage storage;
    private final TransactionTemplate tx;
    public ProductImageController(ProductRepository products, ProductImageStorage storage, PlatformTransactionManager manager) {
        this.products = products; this.storage = storage; tx = new TransactionTemplate(manager);
    }
    public record ImageProduct(UUID id, String nombre, String imagenUrl, String estado) {
        static ImageProduct from(Product product) { return new ImageProduct(product.getId(), product.getName(), product.getImageUrl(), product.getStatus().name()); }
    }
    public record ImagePage(List<ImageProduct> content, int number, int totalPages) {}
    @Operation(summary="Listar productos para asignar imágenes (SUPER_ADMIN)", security=@SecurityRequirement(name="bearerAuth"))
    @GetMapping("/catalog/admin/imagenes/productos")
    public ResponseEntity<ImagePage> list(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue="0") int page) {
        admin(jwt);
        if (page < 0) throw ProductImageStorage.invalid("Página inválida.");
        var result = products.findAll(PageRequest.of(page, 100, Sort.by("name", "id")));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ImagePage(result.map(ImageProduct::from).getContent(), page, result.getTotalPages()));
    }
    @PostMapping(path="/catalog/productos/{id}/imagen", consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary="Cargar una imagen JPEG/PNG de hasta 5 MB (SUPER_ADMIN)", security=@SecurityRequirement(name="bearerAuth"))
    public ResponseEntity<ImageProduct> upload(@PathVariable UUID id, @RequestPart("imagen") MultipartFile file, @AuthenticationPrincipal Jwt jwt) {
        admin(jwt);
        if (!products.existsById(id)) throw productMissing();
        var stored = storage.store(file);
        try {
            ImageProduct result = tx.execute(status -> {
                var product = products.findById(id).orElseThrow(ProductImageController::productMissing);
                product.setImageUrl("/v1/catalog/imagenes/" + stored.key());
                return ImageProduct.from(products.saveAndFlush(product));
            });
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(result);
        } catch (RuntimeException error) { storage.discard(stored.key()); throw error; }
    }
    @GetMapping(path="/catalog/imagenes/{key}", produces=MediaType.IMAGE_PNG_VALUE)
    @Operation(summary="Leer una imagen pública persistida")
    public ResponseEntity<byte[]> read(@PathVariable String key) {
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                .header("X-Content-Type-Options", "nosniff").body(storage.read(key));
    }
    private static void admin(Jwt jwt) {
        if (jwt == null || !"SUPER_ADMIN".equals(jwt.getClaimAsString("role"))) throw new BusinessException(HttpStatus.FORBIDDEN,
                URI.create("/problems/rol-no-permitido"), "Rol no permitido", "Solo SUPER_ADMIN puede gestionar imágenes del catálogo.", "ROL_NO_PERMITIDO");
    }
    private static BusinessException productMissing() { return new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/producto-no-encontrado"), "Producto no encontrado", "El producto no existe.", "PRODUCT_NOT_FOUND"); }
}
