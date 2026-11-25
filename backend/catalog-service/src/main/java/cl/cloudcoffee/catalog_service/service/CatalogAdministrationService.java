package cl.cloudcoffee.catalog_service.service;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import java.util.UUID;

import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.catalog_service.dto.CategoryAdminResponse;
import cl.cloudcoffee.catalog_service.dto.CrearCategoriaRequest;
import cl.cloudcoffee.catalog_service.dto.CrearProductoRequest;
import cl.cloudcoffee.catalog_service.dto.EditarCategoriaRequest;
import cl.cloudcoffee.catalog_service.dto.EditarProductoRequest;
import cl.cloudcoffee.catalog_service.dto.ProductAdminResponse;
import cl.cloudcoffee.catalog_service.model.entity.CatalogAudit;
import cl.cloudcoffee.catalog_service.model.entity.CatalogIdempotency;
import cl.cloudcoffee.catalog_service.model.entity.Category;
import cl.cloudcoffee.catalog_service.model.entity.Product;
import cl.cloudcoffee.catalog_service.model.enums.ProductStatus;
import cl.cloudcoffee.catalog_service.repository.CatalogAuditRepository;
import cl.cloudcoffee.catalog_service.repository.CatalogIdempotencyRepository;
import cl.cloudcoffee.catalog_service.repository.CategoryRepository;
import cl.cloudcoffee.catalog_service.repository.ProductRepository;
import cl.cloudcoffee.errors.BusinessException;
import tools.jackson.databind.json.JsonMapper;

@Service
@Transactional
public class CatalogAdministrationService {
    private static final String CATEGORY = "CATEGORIA";
    private static final String PRODUCT = "PRODUCTO";

    private final CategoryRepository categories;
    private final ProductRepository products;
    private final CatalogAuditRepository audits;
    private final CatalogIdempotencyRepository idempotencies;
    private final JsonMapper json;
    private final Clock clock;

    public CatalogAdministrationService(CategoryRepository categories, ProductRepository products,
            CatalogAuditRepository audits, CatalogIdempotencyRepository idempotencies, JsonMapper json, Clock clock) {
        this.categories = categories;
        this.products = products;
        this.audits = audits;
        this.idempotencies = idempotencies;
        this.json = json;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page<CategoryAdminResponse> listarCategorias(Boolean activa, Pageable pageable, Authentication auth) {
        superAdmin(auth);
        return categories.findAdmin(activa, safePage(pageable)).map(CategoryAdminResponse::from);
    }

    public Creation<CategoryAdminResponse> crearCategoria(CrearCategoriaRequest request, UUID key,
            Authentication auth) {
        superAdmin(auth);
        String nombre = trim(request.nombre());
        String descripcion = trim(request.descripcion());
        validateOptionalText(descripcion, 500, "descripción");
        String hash = fingerprint(nombre, descripcion);
        var replay = replay(CATEGORY, auth.getName(), key, hash, CategoryAdminResponse.class);
        if (replay != null) return new Creation<>(replay, true);
        validateName(nombre, 100);
        if (categories.existsByNameIgnoreCase(nombre)) throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");

        Category category = new Category();
        category.setName(nombre);
        category.setDescription(descripcion);
        category.setActive(true);
        category.setVersion(1L);
        category = categories.saveAndFlush(category);
        CategoryAdminResponse response = CategoryAdminResponse.from(category);
        audit(CATEGORY, category.getId(), "CREAR", auth, "Categoría creada");
        remember(CATEGORY, auth.getName(), key, hash, category.getId(), response);
        return new Creation<>(response, false);
    }

    public CategoryAdminResponse editarCategoria(UUID id, EditarCategoriaRequest request, Authentication auth) {
        superAdmin(auth);
        Category category = categories.findById(id).orElseThrow(() -> notFound("Categoría no encontrada"));
        checkVersion(category.getVersion(), request.version());
        if (request.nombre() != null) {
            String nombre = trim(request.nombre());
            validateName(nombre, 100);
            if (!nombre.equalsIgnoreCase(category.getName()) && categories.existsByNameIgnoreCaseAndIdNot(nombre, id)) {
                throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");
            }
            category.setName(nombre);
        }
        if (request.descripcion() != null) {
            String descripcion = trim(request.descripcion());
            validateOptionalText(descripcion, 500, "descripción");
            category.setDescription(descripcion);
        }
        category = saveCategory(category);
        audit(CATEGORY, id, "EDITAR", auth, "Datos de categoría editados");
        return CategoryAdminResponse.from(category);
    }

    public CategoryAdminResponse bajaCategoria(UUID id, Authentication auth) {
        superAdmin(auth);
        Category category = categories.findById(id).orElseThrow(() -> notFound("Categoría no encontrada"));
        if (!category.isActive()) return CategoryAdminResponse.from(category);
        if (products.countByCategoryIdAndStatus(id, ProductStatus.ACTIVE) > 0) {
            throw conflict("La categoría contiene productos activos", "CATEGORIA_EN_USO");
        }
        category.setActive(false);
        category = saveCategory(category);
        audit(CATEGORY, id, "BAJA", auth, "Baja lógica; productos inactivos conservan su categoría");
        return CategoryAdminResponse.from(category);
    }

    public CategoryAdminResponse reactivarCategoria(UUID id, Authentication auth) {
        superAdmin(auth);
        Category category = categories.findById(id).orElseThrow(() -> notFound("Categoría no encontrada"));
        if (!category.isActive()) {
            category.setActive(true);
            category = saveCategory(category);
            audit(CATEGORY, id, "REACTIVAR", auth, "Categoría reactivada");
        }
        return CategoryAdminResponse.from(category);
    }

    @Transactional(readOnly = true)
    public Page<ProductAdminResponse> listarProductos(UUID categoriaId, String q, Boolean activo,
            Pageable pageable, Authentication auth) {
        superAdmin(auth);
        String query = q == null ? null : q.trim();
        if (query != null && (query.length() < 2 || query.length() > 100)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/filtro-invalido"),
                    "Filtro inválido", "El filtro q debe contener entre 2 y 100 caracteres.");
        }
        return products.findAdmin(categoriaId, activo,
                activo == null ? null : activo ? ProductStatus.ACTIVE : ProductStatus.INACTIVE,
                query, safePage(pageable))
                .map(ProductAdminResponse::from);
    }

    public Creation<ProductAdminResponse> crearProducto(CrearProductoRequest request, UUID key, Authentication auth) {
        superAdmin(auth);
        String nombre = trim(request.nombre());
        String descripcion = trim(request.descripcion());
        String imagenUrl = trim(request.imagenUrl());
        validateOptionalText(descripcion, 1000, "descripción");
        String hash = fingerprint(request.categoriaId().toString(), nombre, descripcion, imagenUrl);
        var replay = replay(PRODUCT, auth.getName(), key, hash, ProductAdminResponse.class);
        if (replay != null) return new Creation<>(replay, true);
        validateName(nombre, 150);
        validateImage(request.hasValidImageUri());
        if (products.existsByNameIgnoreCase(nombre)) throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");
        Category category = activeCategory(request.categoriaId());

        Product product = new Product();
        product.setCategory(category);
        product.setName(nombre);
        product.setDescription(descripcion);
        product.setImageUrl(imagenUrl);
        product.setStatus(ProductStatus.ACTIVE);
        product.setVersion(1L);
        product = products.saveAndFlush(product);
        ProductAdminResponse response = ProductAdminResponse.from(product);
        audit(PRODUCT, product.getId(), "CREAR", auth, "Producto creado");
        remember(PRODUCT, auth.getName(), key, hash, product.getId(), response);
        return new Creation<>(response, false);
    }

    public ProductAdminResponse editarProducto(UUID id, EditarProductoRequest request, Authentication auth) {
        superAdmin(auth);
        Product product = products.findById(id).orElseThrow(() -> notFound("Producto no encontrado"));
        checkVersion(product.getVersion(), request.version());
        if (request.categoriaId() != null) product.setCategory(activeCategory(request.categoriaId()));
        if (request.nombre() != null) {
            String nombre = trim(request.nombre());
            validateName(nombre, 150);
            if (!nombre.equalsIgnoreCase(product.getName()) && products.existsByNameIgnoreCaseAndIdNot(nombre, id)) {
                throw conflict("Nombre duplicado", "NOMBRE_DUPLICADO");
            }
            product.setName(nombre);
        }
        if (request.descripcion() != null) {
            String descripcion = trim(request.descripcion());
            validateOptionalText(descripcion, 1000, "descripción");
            product.setDescription(descripcion);
        }
        if (request.imagenUrl() != null) {
            validateImage(request.hasValidImageUri());
            product.setImageUrl(trim(request.imagenUrl()));
        }
        product = saveProduct(product);
        audit(PRODUCT, id, "EDITAR", auth, "Datos de producto editados");
        return ProductAdminResponse.from(product);
    }

    public ProductAdminResponse bajaProducto(UUID id, Authentication auth) {
        superAdmin(auth);
        Product product = products.findById(id).orElseThrow(() -> notFound("Producto no encontrado"));
        if (product.getStatus() == ProductStatus.ACTIVE) {
            product.setStatus(ProductStatus.INACTIVE);
            product = saveProduct(product);
            audit(PRODUCT, id, "BAJA", auth, "Baja lógica; ofertas e historial conservados");
        }
        return ProductAdminResponse.from(product);
    }

    public ProductAdminResponse reactivarProducto(UUID id, Authentication auth) {
        superAdmin(auth);
        Product product = products.findById(id).orElseThrow(() -> notFound("Producto no encontrado"));
        if (product.getStatus() == ProductStatus.INACTIVE) {
            if (!product.getCategory().isActive()) {
                throw conflict("No se puede reactivar un producto de una categoría inactiva", "PRODUCTO_INACTIVO");
            }
            product.setStatus(ProductStatus.ACTIVE);
            product = saveProduct(product);
            audit(PRODUCT, id, "REACTIVAR", auth, "Producto reactivado");
        }
        return ProductAdminResponse.from(product);
    }

    private Category activeCategory(UUID id) {
        Category category = categories.findById(id).orElseThrow(() -> notFound("Categoría no encontrada"));
        if (!category.isActive()) throw conflict("La categoría está dada de baja", "PRODUCTO_INACTIVO");
        return category;
    }

    private <T> T replay(String resourceType, String actorId, UUID key, String hash, Class<T> responseType) {
        var previous = idempotencies.findByResourceTypeAndActorIdAndIdempotencyKey(resourceType, actorId, key);
        if (previous.isEmpty()) return null;
        CatalogIdempotency record = previous.get();
        if (!record.getRequestHash().equals(hash)) {
            throw conflict("La Idempotency-Key ya se usó con una solicitud distinta", "IDEMPOTENCY_CONFLICT");
        }
        return json.readValue(record.getResponseBody(), responseType);
    }

    private void remember(String resourceType, String actorId, UUID key, String hash, UUID resourceId, Object response) {
        CatalogIdempotency record = new CatalogIdempotency();
        record.setResourceType(resourceType);
        record.setActorId(actorId);
        record.setIdempotencyKey(key);
        record.setRequestHash(hash);
        record.setResourceId(resourceId);
        record.setResponseBody(json.writeValueAsString(response));
        idempotencies.saveAndFlush(record);
    }

    private void audit(String resourceType, UUID resourceId, String action, Authentication auth, String detail) {
        CatalogAudit entry = new CatalogAudit();
        entry.setResourceType(resourceType);
        entry.setResourceId(resourceId);
        entry.setAction(action);
        entry.setActorId(auth.getName());
        entry.setDetail(detail);
        entry.setCreatedAt(clock.instant());
        audits.save(entry);
    }

    private Category saveCategory(Category category) {
        try {
            return categories.saveAndFlush(category);
        } catch (OptimisticLockingFailureException exception) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
    }

    private Product saveProduct(Product product) {
        try {
            return products.saveAndFlush(product);
        } catch (OptimisticLockingFailureException exception) {
            throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
        }
    }

    private static Pageable safePage(Pageable pageable) {
        return PageRequest.of(Math.max(0, pageable.getPageNumber()),
                Math.max(1, Math.min(100, pageable.getPageSize())));
    }

    private static void superAdmin(Authentication auth) {
        boolean allowed = auth != null && auth.getAuthorities().stream()
                .anyMatch(authority -> "ROLE_SUPER_ADMIN".equals(authority.getAuthority()));
        if (!allowed) throw new AccessDeniedException("Rol no permitido");
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static void validateName(String name, int maximum) {
        if (name == null || name.isBlank() || name.length() > maximum) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/nombre-invalido"),
                    "Nombre inválido", "El nombre es obligatorio y no puede exceder " + maximum + " caracteres.");
        }
    }

    private static void validateImage(boolean valid) {
        if (!valid) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/imagen-url-invalida"),
                    "Imagen URL inválida", "La imagen debe ser una URL HTTPS válida de hasta 255 caracteres.");
        }
    }

    private static void validateOptionalText(String value, int maximum, String field) {
        if (value != null && (value.isBlank() || value.length() > maximum)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/texto-invalido"),
                    "Texto inválido", "La " + field + " debe contener texto y no exceder " + maximum + " caracteres.");
        }
    }

    private static void checkVersion(Long actual, long requested) {
        if (actual == null || actual != requested) throw conflict("La versión del recurso no coincide", "VERSION_CONFLICTO");
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
            throw new IllegalStateException("SHA-256 is required by the Java platform", exception);
        }
    }

    private static BusinessException conflict(String detail, String code) {
        return new BusinessException(HttpStatus.CONFLICT,
                URI.create("/problems/" + code.toLowerCase().replace('_', '-')), "Conflicto", detail, code);
    }

    private static BusinessException notFound(String detail) {
        return new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/recurso-no-encontrado"),
                "Recurso no encontrado", detail);
    }

    public record Creation<T>(T response, boolean replayed) {
    }
}
