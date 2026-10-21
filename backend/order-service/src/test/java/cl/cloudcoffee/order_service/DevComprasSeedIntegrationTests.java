package cl.cloudcoffee.order_service;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-76: con el perfil dev, el comprador de prueba puede simular el pago de sus compras. */
// Base propia: en CI las demás pruebas comparten un PostgreSQL sin datos de prueba.
@SpringBootTest(properties = {
        "management.tracing.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:dev-order-seed;DB_CLOSE_DELAY=-1",
        "spring.datasource.username=sa",
        "spring.datasource.password="
})
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class DevComprasSeedIntegrationTests extends JwtTestSupport {

    static final String COMPRADOR = "66666666-6666-4666-8666-666666666601";
    static final String COMPRA_DEL_COMPRADOR = "77777777-7777-4777-8777-777777777701";
    static final String COMPRA_AJENA = "77777777-7777-4777-8777-777777777703";

    @Autowired
    MockMvc mvc;

    @Test
    void compradorSimulaElPagoDeSuCompraSembrada() throws Exception {
        mvc.perform(post("/compras/{id}/pago", COMPRA_DEL_COMPRADOR)
                        .header("Authorization", "Bearer " + comprador())
                        .header("Idempotency-Key", java.util.UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"escenario\":\"aprobar\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.montoTotal").value(3700));
    }

    @Test
    void compradorNoVeLaCompraSembradaDeOtroUsuario() throws Exception {
        mvc.perform(get("/compras/{id}/pago", COMPRA_AJENA).header("Authorization", "Bearer " + comprador()))
                .andExpect(status().isNotFound());
    }

    private static String comprador() {
        return sign(claims().subject(COMPRADOR).build(), KEYS, JWSAlgorithm.RS256);
    }
}
