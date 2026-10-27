package cl.cloudcoffee.catalog_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import javax.sql.DataSource;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import cl.cloudcoffee.catalog_service.dto.ReserveStockRequest;
import cl.cloudcoffee.catalog_service.messaging.StockEventPublisher;
import cl.cloudcoffee.catalog_service.service.StockReservationService;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/**
 * INT2-36: carga el seed de desarrollo y verifica sobre él los filtros,
 * la búsqueda y la comparación de precios del catálogo.
 */
// Base propia: en CI las demás pruebas comparten un PostgreSQL vacío
// (SPRING_DATASOURCE_URL) y el seed no debe filtrarse hacia ellas.
@SpringBootTest(properties = {
        "management.tracing.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:dev-catalog-seed;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class DevCatalogSeedIntegrationTests extends JwtTestSupport {

    static final String SEED = "db/seed/dev/R__seed_catalogo_desarrollo.sql";
    static final String CAMPUS_SAN_FRANCISCO = "11111111-1111-4111-8111-111111111111";
    static final String CAMPUS_SAN_JUAN_PABLO = "11111111-1111-4111-8111-111111111112";
    static final String CATEGORIA_CAFES = "22222222-2222-4222-8222-222222222222";
    static final String CATEGORIA_BEBIDAS_FRIAS = "22222222-2222-4222-8222-222222222223";
    static final String CAFE_AMERICANO = "33333333-3333-4333-8333-333333333333";
    static final String LATTE_VAINILLA = "33333333-3333-4333-8333-333333333335";
    static final String AGUA_MINERAL = "33333333-3333-4333-8333-333333333339";
    static final String BROWNIE = "33333333-3333-4333-8333-33333333333c";
    static final String AMERICANO_CENTRAL = "55555555-5555-4555-8555-555555555501";

    @Autowired
    MockMvc mvc;

    @Autowired
    StockReservationService reservas;

    // Las reservas publican eventos de stock; aquí no hay broker.
    @MockitoBean
    StockEventPublisher stockEventPublisher;

    @Autowired
    DataSource dataSource;

    @Autowired
    JdbcTemplate jdbcTemplate;

    @Test
    void seedCargaDosCampusConSusCafeterias() throws Exception {
        mvc.perform(get("/catalog/campus"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].nombre", contains("Campus San Francisco", "Campus San Juan Pablo II")))
                .andExpect(jsonPath("$[0].cafeterias[*].nombre",
                        contains("Cafetería Biblioteca", "Cafetería Central", "Cafetería Ingeniería")))
                .andExpect(jsonPath("$[1].cafeterias[*].nombre",
                        contains("Cafetería Patio Norte", "Kiosko Gimnasio")));
    }

    @Test
    void seedCargaCategoriasOrdenadas() throws Exception {
        mvc.perform(get("/catalog/categorias"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].nombre",
                        contains("Bebidas frías", "Cafés", "Pastelería", "Sándwiches")));
    }

    @Test
    void detallePublicoDevuelveSoloDatosPublicosDelProductoActivoSinJwt() throws Exception {
        String imageUrl = "https://example.com/cafe-americano.png";
        jdbcTemplate.update("UPDATE product SET image_url = ? WHERE id = ?",
                imageUrl, UUID.fromString(CAFE_AMERICANO));
        try {
            mvc.perform(get("/catalog/productos/{id}", CAFE_AMERICANO))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(CAFE_AMERICANO))
                    .andExpect(jsonPath("$.nombre").value("Café americano"))
                    .andExpect(jsonPath("$.descripcion").value("Café de filtro recién preparado"))
                    .andExpect(jsonPath("$.imagenUrl").value(imageUrl))
                    .andExpect(jsonPath("$.categoria.id").value(CATEGORIA_CAFES))
                    .andExpect(jsonPath("$.categoria.nombre").value("Cafés"))
                    .andExpect(jsonPath("$.estado").doesNotExist())
                    .andExpect(jsonPath("$.price").doesNotExist())
                    .andExpect(jsonPath("$.stock").doesNotExist());
        } finally {
            jdbcTemplate.update("UPDATE product SET image_url = NULL WHERE id = ?",
                    UUID.fromString(CAFE_AMERICANO));
        }
    }

    @Test
    void detallePublicoResponde404ConProblemDetailsParaProductoInexistente() throws Exception {
        mvc.perform(get("/catalog/productos/{id}", "33333333-3333-4333-8333-3333333333ff"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.type").value("/problems/producto-no-encontrado"))
                .andExpect(jsonPath("$.detail").value(
                        "No existe un producto activo con el identificador indicado."));
    }

    @Test
    void detallePublicoOcultaProductosInactivosComoNoEncontrados() throws Exception {
        UUID productId = UUID.fromString(CAFE_AMERICANO);
        jdbcTemplate.update("UPDATE product SET status = 'INACTIVE' WHERE id = ?", productId);
        try {
            mvc.perform(get("/catalog/productos/{id}", CAFE_AMERICANO))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.status").value(404))
                    .andExpect(jsonPath("$.detail").value(
                            "No existe un producto activo con el identificador indicado."));
        } finally {
            jdbcTemplate.update("UPDATE product SET status = 'ACTIVE' WHERE id = ?", productId);
        }
    }

    @Test
    void consultasPublicasAdmitenHeadSinJwt() throws Exception {
        mvc.perform(head("/catalog/productos/{id}", CAFE_AMERICANO))
                .andExpect(status().isOk());
        mvc.perform(head("/catalog/productos").param("campusId", CAMPUS_SAN_FRANCISCO))
                .andExpect(status().isOk());
        mvc.perform(head("/catalog/productos/{id}/ofertas", CAFE_AMERICANO)
                        .param("campusId", CAMPUS_SAN_FRANCISCO))
                .andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "productos",
            "productos/33333333-3333-4333-8333-333333333333",
            "productos/33333333-3333-4333-8333-333333333333/ofertas"
    })
    void jwtInvalidoSeRechazaEnConsultasPublicas(String endpoint) throws Exception {
        mvc.perform(get("/catalog/" + endpoint)
                        .param("campusId", CAMPUS_SAN_FRANCISCO)
                        .header("Authorization", "Bearer not-a-jwt"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void productosSoloIncluyeOfertasPublicadasDelCampus() throws Exception {
        // Fuera: Brownie (cafetería cerrada), Agua mineral (OUT_OF_STOCK) y los de otro campus.
        productos(CAMPUS_SAN_FRANCISCO, null, null)
                .andExpect(jsonPath("$.totalElements").value(8))
                .andExpect(jsonPath("$.content[*].nombre", contains(
                        "Café americano", "Cappuccino", "Frappé moca", "Jugo natural de naranja",
                        "Latte de vainilla", "Medialuna", "Muffin de arándanos", "Sándwich ave palta")));

        // Fuera: Brownie y Agua mineral del kiosko en mantención.
        productos(CAMPUS_SAN_JUAN_PABLO, null, null)
                .andExpect(jsonPath("$.content[*].nombre", contains(
                        "Café americano", "Café helado", "Jugo natural de naranja",
                        "Medialuna", "Sándwich vegetariano")));
    }

    @Test
    void productoConOfertasEnVariasCafeteriasApareceUnaVez() throws Exception {
        productos(CAMPUS_SAN_FRANCISCO, null, "americano")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(CAFE_AMERICANO));
    }

    @Test
    void filtraPorCategoria() throws Exception {
        productos(CAMPUS_SAN_FRANCISCO, CATEGORIA_CAFES, null)
                .andExpect(jsonPath("$.content[*].nombre",
                        contains("Café americano", "Cappuccino", "Latte de vainilla")))
                .andExpect(jsonPath("$.content[*].categoriaId",
                        contains(CATEGORIA_CAFES, CATEGORIA_CAFES, CATEGORIA_CAFES)));
    }

    @Test
    void buscaEnNombreYDescripcionSinDistinguirMayusculas() throws Exception {
        // "Frappé moca" solo menciona el café en su descripción.
        productos(CAMPUS_SAN_FRANCISCO, null, "CAFÉ")
                .andExpect(jsonPath("$.content[*].nombre", contains("Café americano", "Frappé moca")));
    }

    @Test
    void combinaBusquedaYCategoria() throws Exception {
        productos(CAMPUS_SAN_FRANCISCO, CATEGORIA_BEBIDAS_FRIAS, "café")
                .andExpect(jsonPath("$.content[*].nombre", contains("Frappé moca")));
    }

    @Test
    void busquedaSinCoincidenciasDevuelvePaginaVacia() throws Exception {
        productos(CAMPUS_SAN_FRANCISCO, null, "empanada")
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void paginaLosProductosDelCampus() throws Exception {
        mvc.perform(get("/catalog/productos")
                        .header("Authorization", "Bearer " + token())
                        .param("campusId", CAMPUS_SAN_FRANCISCO)
                        .param("page", "1").param("size", "3").param("sort", "name,asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].nombre",
                        contains("Jugo natural de naranja", "Latte de vainilla", "Medialuna")))
                .andExpect(jsonPath("$.totalElements").value(8))
                .andExpect(jsonPath("$.totalPages").value(3));
    }

    @Test
    void comparaOfertasDelCampusPorPrecioAscendente() throws Exception {
        // La oferta de Cafetería Ingeniería (1100, cerrada) no participa.
        ofertas(CAFE_AMERICANO, CAMPUS_SAN_FRANCISCO)
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[*].cafeteriaName", contains("Cafetería Biblioteca", "Cafetería Central")))
                .andExpect(jsonPath("$[*].price", contains(1300.0, 1500.0)))
                .andExpect(jsonPath("$[*].stock", contains(3, 40)))
                .andExpect(jsonPath("$[*].disponible", contains(true, true)));

        ofertas(CAFE_AMERICANO, CAMPUS_SAN_JUAN_PABLO)
                .andExpect(jsonPath("$[*].cafeteriaName", contains("Cafetería Patio Norte")))
                .andExpect(jsonPath("$[*].price", contains(1600.0)));
    }

    @Test
    void ofertaSinStockSePublicaComoNoDisponible() throws Exception {
        ofertas(LATTE_VAINILLA, CAMPUS_SAN_FRANCISCO)
                .andExpect(jsonPath("$[*].stock", contains(0)))
                .andExpect(jsonPath("$[*].disponible", contains(false)));
    }

    @Test
    void ofertasDeCafeteriaNoAbiertaOAgotadaNoSePublican() throws Exception {
        ofertas(BROWNIE, CAMPUS_SAN_FRANCISCO).andExpect(jsonPath("$").isEmpty());
        ofertas(BROWNIE, CAMPUS_SAN_JUAN_PABLO).andExpect(jsonPath("$").isEmpty());
        ofertas(AGUA_MINERAL, CAMPUS_SAN_FRANCISCO).andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void seedEsIdempotente() throws Exception {
        // Flyway lo re-ejecuta cada vez que cambia su checksum.
        new ResourceDatabasePopulator(new ClassPathResource(SEED)).execute(dataSource);

        mvc.perform(get("/catalog/campus")).andExpect(jsonPath("$", hasSize(2)));
        productos(CAMPUS_SAN_FRANCISCO, null, null).andExpect(jsonPath("$.totalElements").value(8));
        ofertas(CAFE_AMERICANO, CAMPUS_SAN_FRANCISCO).andExpect(jsonPath("$", hasSize(2)));
    }

    @Test
    void reEjecutarElSeedConservaElStockDeLasReservasActivas() {
        UUID orden = UUID.randomUUID();
        UUID oferta = UUID.fromString(AMERICANO_CENTRAL);
        reservas.reserve(new ReserveStockRequest(orden, oferta, 5));
        try {
            long version = version(oferta);

            new ResourceDatabasePopulator(new ClassPathResource(SEED)).execute(dataSource);

            // El seed no devuelve las 5 unidades reservadas, pero sí marca la fila como cambiada.
            assertThat(stock(oferta)).isEqualTo(35);
            assertThat(version(oferta)).isGreaterThan(version);
        } finally {
            reservas.release(orden, oferta);
        }
        assertThat(stock(oferta)).isEqualTo(40);
    }

    private int stock(UUID oferta) {
        return jdbcTemplate.queryForObject("SELECT stock FROM offer WHERE id = ?", Integer.class, oferta);
    }

    private long version(UUID oferta) {
        return jdbcTemplate.queryForObject("SELECT version FROM offer WHERE id = ?", Long.class, oferta);
    }

    private ResultActions productos(String campusId, String categoriaId, String q) throws Exception {
        var request = get("/catalog/productos")
                .param("campusId", campusId)
                .param("sort", "name,asc");
        if (categoriaId != null) {
            request.param("categoriaId", categoriaId);
        }
        if (q != null) {
            request.param("q", q);
        }
        return mvc.perform(request).andExpect(status().isOk());
    }

    private ResultActions ofertas(String productId, String campusId) throws Exception {
        return mvc.perform(get("/catalog/productos/{id}/ofertas", productId)
                        .param("campusId", campusId))
                .andExpect(status().isOk());
    }
}
