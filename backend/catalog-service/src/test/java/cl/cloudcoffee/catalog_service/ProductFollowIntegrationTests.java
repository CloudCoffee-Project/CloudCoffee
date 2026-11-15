package cl.cloudcoffee.catalog_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.json.JsonMapper;

/**
 * INT2-116: seguimientos de productos del cliente, con el seed de catálogo de desarrollo
 * (INT2-36) en una base H2 propia para no interferir con otras pruebas.
 */
@SpringBootTest(properties = {
        "management.tracing.enabled=false",
        "spring.rabbitmq.listener.simple.auto-startup=false",
        "spring.datasource.url=jdbc:h2:mem:seguimientos;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class ProductFollowIntegrationTests extends JwtTestSupport {

    static final UUID CENTRAL = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final UUID CAFE_AMERICANO = UUID.fromString("33333333-3333-4333-8333-333333333333");
    static final UUID CAFE_HELADO = UUID.fromString("33333333-3333-4333-8333-333333333336"); // no se ofrece en Central
    static final UUID AGUA_MINERAL = UUID.fromString("33333333-3333-4333-8333-333333333339"); // agotada en Central
    static final UUID CATEGORIA_CAFES = UUID.fromString("22222222-2222-4222-8222-222222222222");

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JsonMapper json;

    @Test
    void seguimientoGeneralYPuntualSeListanSoloParaSuDuenoDelMasRecienteAlMasAntiguo() throws Exception {
        UUID cliente = UUID.randomUUID();
        UUID otroCliente = UUID.randomUUID();

        String general = seguir(cliente, CAFE_AMERICANO, null)
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("/v1/catalog/seguimientos/")))
                .andExpect(jsonPath("$.productoNombre").value("Café americano"))
                .andExpect(jsonPath("$.cafeteriaId").value(nullValue()))
                .andExpect(jsonPath("$.cafeteriaNombre").value(nullValue()))
                .andReturn().getResponse().getContentAsString();
        seguir(cliente, CAFE_AMERICANO, CENTRAL)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cafeteriaId").value(CENTRAL.toString()))
                .andExpect(jsonPath("$.cafeteriaNombre").value("Cafetería Central"));
        seguir(otroCliente, CAFE_AMERICANO, null).andExpect(status().isCreated());

        listar(cliente)
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "2"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$", hasSize(2)))
                // El más reciente primero: el puntual se creó después del general.
                .andExpect(jsonPath("$[0].cafeteriaId").value(CENTRAL.toString()))
                .andExpect(jsonPath("$[1].id").value(json.readTree(general).path("id").asString()))
                .andExpect(jsonPath("$[1].productoId").value(CAFE_AMERICANO.toString()))
                .andExpect(jsonPath("$[1].creadoAt").isNotEmpty());
        listar(otroCliente).andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void altaRepetidaDevuelveElMismoSeguimientoSinDuplicar() throws Exception {
        UUID cliente = UUID.randomUUID();
        for (UUID cafeteria : new UUID[]{null, CENTRAL}) {
            String primero = seguir(cliente, CAFE_AMERICANO, cafeteria).andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String segundo = seguir(cliente, CAFE_AMERICANO, cafeteria).andExpect(status().isOk())
                    .andExpect(header().doesNotExist("Location"))
                    .andReturn().getResponse().getContentAsString();
            assertThat(segundo).isEqualTo(primero);
        }
        // El general y el puntual son seguimientos distintos; cada uno existe una sola vez.
        assertThat(filas(cliente)).isEqualTo(2);
    }

    @Test
    void altaConcurrenteCreaUnSoloSeguimiento() throws Exception {
        UUID cliente = UUID.randomUUID();
        CountDownLatch inicio = new CountDownLatch(1);
        List<Future<MvcResult>> resultados = new ArrayList<>();
        try (var pool = Executors.newFixedThreadPool(6)) {
            for (int i = 0; i < 6; i++) {
                Callable<MvcResult> alta = () -> {
                    inicio.await();
                    return seguir(cliente, CAFE_AMERICANO, null).andReturn();
                };
                resultados.add(pool.submit(alta));
            }
            inicio.countDown();
            List<Integer> estados = new ArrayList<>();
            List<String> ids = new ArrayList<>();
            for (var resultado : resultados) {
                var respuesta = resultado.get().getResponse();
                estados.add(respuesta.getStatus());
                ids.add(json.readTree(respuesta.getContentAsString()).path("id").asString());
            }
            assertThat(estados).containsOnly(200, 201);
            assertThat(estados.stream().filter(estado -> estado == 201)).hasSize(1);
            assertThat(ids).allMatch(id -> id.equals(ids.getFirst()));
        }
        assertThat(filas(cliente)).isEqualTo(1);
    }

    @Test
    void validaProductoYOfertaDeLaCafeteria() throws Exception {
        UUID cliente = UUID.randomUUID();

        problema(seguir(cliente, UUID.randomUUID(), null), 404, "PRODUCTO_NO_ENCONTRADO");
        problema(seguir(cliente, productoInactivo(), null), 409, "PRODUCTO_INACTIVO");
        problema(seguir(cliente, CAFE_HELADO, CENTRAL), 404, "OFERTA_NO_ENCONTRADA");
        problema(seguir(cliente, CAFE_AMERICANO, UUID.randomUUID()), 404, "OFERTA_NO_ENCONTRADA");
        problema(mvc.perform(post("/catalog/seguimientos").header("Authorization", bearer(cliente, "CLIENTE"))
                .contentType(MediaType.APPLICATION_JSON).content("{}")), 400, "SOLICITUD_INVALIDA");
        mvc.perform(post("/catalog/seguimientos").header("Authorization", bearer(cliente, "CLIENTE"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"productoId\":\"no-es-uuid\"}"))
                .andExpect(status().isBadRequest());
        assertThat(filas(cliente)).isZero();

        // Seguir un producto agotado en esa cafetería es justamente el caso del aviso de reposición.
        seguir(cliente, AGUA_MINERAL, CENTRAL).andExpect(status().isCreated());
    }

    @Test
    void bajaIdempotenteYVolverASeguirReactivaElMismoSeguimiento() throws Exception {
        UUID cliente = UUID.randomUUID();
        String id = idDe(seguir(cliente, CAFE_AMERICANO, CENTRAL).andExpect(status().isCreated()));

        dejarDeSeguir(cliente, id).andExpect(status().isNoContent()).andExpect(content().string(""));
        dejarDeSeguir(cliente, id).andExpect(status().isNoContent());
        listar(cliente).andExpect(jsonPath("$", hasSize(0))).andExpect(header().string("X-Total-Count", "0"));

        String reactivado = idDe(seguir(cliente, CAFE_AMERICANO, CENTRAL).andExpect(status().isCreated()));
        assertThat(reactivado).isEqualTo(id);
        listar(cliente).andExpect(jsonPath("$", hasSize(1)));
        assertThat(filas(cliente)).isEqualTo(1);
    }

    @Test
    void unSeguimientoAjenoOInexistenteNoSeRevelaNiSeBorra() throws Exception {
        UUID dueno = UUID.randomUUID();
        UUID otro = UUID.randomUUID();
        String id = idDe(seguir(dueno, CAFE_AMERICANO, null));

        problema(dejarDeSeguir(otro, id), 404, "SEGUIMIENTO_NO_ENCONTRADO");
        problema(dejarDeSeguir(dueno, UUID.randomUUID().toString()), 404, "SEGUIMIENTO_NO_ENCONTRADO");

        listar(dueno).andExpect(jsonPath("$", hasSize(1)));
        listar(otro).andExpect(jsonPath("$", hasSize(0)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void soloUnClienteGestionaSeguimientos(String rol) throws Exception {
        UUID usuario = UUID.randomUUID();
        String token = bearer(usuario, rol);
        problema(mvc.perform(get("/catalog/seguimientos").header("Authorization", token)), 403, "ROL_NO_PERMITIDO");
        problema(mvc.perform(post("/catalog/seguimientos").header("Authorization", token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"productoId\":\"" + CAFE_AMERICANO + "\"}")), 403, "ROL_NO_PERMITIDO");
        problema(mvc.perform(delete("/catalog/seguimientos/{id}", UUID.randomUUID()).header("Authorization", token)),
                403, "ROL_NO_PERMITIDO");
        assertThat(filas(usuario)).isZero();
    }

    @Test
    void sinJwtResponde401() throws Exception {
        mvc.perform(get("/catalog/seguimientos")).andExpect(status().isUnauthorized());
        mvc.perform(post("/catalog/seguimientos").contentType(MediaType.APPLICATION_JSON)
                .content("{\"productoId\":\"" + CAFE_AMERICANO + "\"}")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/catalog/seguimientos/{id}", UUID.randomUUID())).andExpect(status().isUnauthorized());
    }

    @Test
    void paginacionExplicitaConTotalEnCabecera() throws Exception {
        UUID cliente = UUID.randomUUID();
        seguir(cliente, CAFE_AMERICANO, null).andExpect(status().isCreated());
        seguir(cliente, CAFE_AMERICANO, CENTRAL).andExpect(status().isCreated());
        seguir(cliente, AGUA_MINERAL, CENTRAL).andExpect(status().isCreated());

        mvc.perform(get("/catalog/seguimientos").param("page", "1").param("size", "2")
                        .header("Authorization", bearer(cliente, "CLIENTE")))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Total-Count", "3"))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].cafeteriaId").value(nullValue()));
        for (String[] invalido : new String[][]{{"page", "-1"}, {"size", "0"}, {"size", "101"}}) {
            problema(mvc.perform(get("/catalog/seguimientos").param(invalido[0], invalido[1])
                    .header("Authorization", bearer(cliente, "CLIENTE"))), 400, "PAGINACION_INVALIDA");
        }
    }

    private UUID productoInactivo() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO product (id, category_id, name, status) VALUES (?, ?, ?, 'INACTIVE')",
                id, CATEGORIA_CAFES, "Producto retirado " + id);
        return id;
    }

    private int filas(UUID usuario) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM product_follow WHERE user_id = ?", Integer.class, usuario);
    }

    private ResultActions seguir(UUID usuario, UUID producto, UUID cafeteria) throws Exception {
        String cuerpo = cafeteria == null
                ? "{\"productoId\":\"" + producto + "\",\"cafeteriaId\":null}"
                : "{\"productoId\":\"" + producto + "\",\"cafeteriaId\":\"" + cafeteria + "\"}";
        return mvc.perform(post("/catalog/seguimientos").header("Authorization", bearer(usuario, "CLIENTE"))
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo));
    }

    private ResultActions listar(UUID usuario) throws Exception {
        return mvc.perform(get("/catalog/seguimientos").header("Authorization", bearer(usuario, "CLIENTE")));
    }

    private ResultActions dejarDeSeguir(UUID usuario, String id) throws Exception {
        return mvc.perform(delete("/catalog/seguimientos/{id}", id).header("Authorization", bearer(usuario, "CLIENTE")));
    }

    private String idDe(ResultActions resultado) throws Exception {
        return json.readTree(resultado.andReturn().getResponse().getContentAsString()).path("id").asString();
    }

    private static void problema(ResultActions resultado, int estado, String code) throws Exception {
        resultado.andExpect(status().is(estado))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value(code));
    }

    private static String bearer(UUID usuario, String rol) {
        return "Bearer " + sign(claims().subject(usuario.toString()).claim("role", rol).build(), KEYS, JWSAlgorithm.RS256);
    }
}
