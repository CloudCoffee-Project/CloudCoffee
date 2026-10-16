package cl.cloudcoffee.order_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-76: simulación determinista y consulta del pago, solo para el dueño de la compra. */
@SpringBootTest(properties = "management.tracing.enabled=false")
@AutoConfigureMockMvc
class PagoSimuladoControllerTest extends JwtTestSupport {

    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;

    final UUID dueno = UUID.randomUUID();

    @Test
    void escenarioAprobadoCreaElPagoConElMontoDeLaCompra() throws Exception {
        Compra compra = compra("3700.00");

        simular(compra, dueno, "clave-1", "APROBADO")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.compraId").value(compra.getId().toString()))
                .andExpect(jsonPath("$.estado").value("APROBADO"))
                .andExpect(jsonPath("$.monto").value(3700.00))
                .andExpect(jsonPath("$.motivoRechazo").doesNotExist())
                // Sin proveedor externo: no hay redirección de pago.
                .andExpect(jsonPath("$.initPoint").doesNotExist());

        consultar(compra, dueno)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("APROBADO"));
    }

    @Test
    void escenarioRechazadoEsDeterminista() throws Exception {
        Compra compra = compra("1500.00");

        simular(compra, dueno, "clave-1", "RECHAZADO")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.estado").value("RECHAZADO"))
                .andExpect(jsonPath("$.motivoRechazo").value("Pago rechazado por la simulación."));
    }

    @Test
    void pendienteSeResuelveEnElMismoPagoSinCrearOtro() throws Exception {
        Compra compra = compra("1500.00");
        String pagoId = id(simular(compra, dueno, "clave-1", "PENDIENTE")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.estado").value("PENDIENTE")));

        simular(compra, dueno, "clave-2", "APROBADO")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pagoId").value(pagoId))
                .andExpect(jsonPath("$.estado").value("APROBADO"));

        assertThat(pagosDe(compra)).hasSize(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"APROBADO", "RECHAZADO", "PENDIENTE"})
    void reintentoConLaMismaClaveNoDuplicaElPago(String escenario) throws Exception {
        Compra compra = compra("1500.00");
        String pagoId = id(simular(compra, dueno, "clave-reintento", escenario).andExpect(status().isCreated()));

        simular(compra, dueno, "clave-reintento", escenario)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pagoId").value(pagoId))
                .andExpect(jsonPath("$.estado").value(escenario));
        simular(compra, dueno, "clave-reintento", escenario).andExpect(status().isOk());

        assertThat(pagosDe(compra)).hasSize(1);
    }

    @Test
    void mismaClaveConOtroEscenarioResponde409() throws Exception {
        Compra compra = compra("1500.00");
        simular(compra, dueno, "clave-1", "RECHAZADO").andExpect(status().isCreated());

        simular(compra, dueno, "clave-1", "APROBADO")
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));

        assertThat(pagosDe(compra)).extracting(Pago::getEstado).containsExactly(EstadoPago.RECHAZADO);
    }

    @Test
    void trasUnRechazoUnaClaveNuevaAbreOtroIntento() throws Exception {
        Compra compra = compra("1500.00");
        simular(compra, dueno, "clave-1", "RECHAZADO").andExpect(status().isCreated());

        simular(compra, dueno, "clave-2", "APROBADO")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.estado").value("APROBADO"));

        assertThat(pagosDe(compra)).extracting(Pago::getEstado)
                .containsExactly(EstadoPago.RECHAZADO, EstadoPago.APROBADO);
        consultar(compra, dueno).andExpect(jsonPath("$.estado").value("APROBADO"));
    }

    @Test
    void unaCompraPagadaNoAdmiteOtroPago() throws Exception {
        Compra compra = compra("1500.00");
        simular(compra, dueno, "clave-1", "APROBADO").andExpect(status().isCreated());

        simular(compra, dueno, "clave-2", "APROBADO").andExpect(status().isConflict());
        simular(compra, dueno, "clave-3", "RECHAZADO").andExpect(status().isConflict());

        assertThat(pagosDe(compra)).hasSize(1);
    }

    @Test
    void otroUsuarioNoSimulaNiConsultaLaCompra() throws Exception {
        Compra compra = compra("1500.00");
        UUID ajeno = UUID.randomUUID();

        simular(compra, ajeno, "clave-1", "APROBADO").andExpect(status().isNotFound());
        simular(compra, dueno, "clave-1", "PENDIENTE").andExpect(status().isCreated());
        consultar(compra, ajeno).andExpect(status().isNotFound());

        assertThat(pagosDe(compra)).extracting(Pago::getEstado).containsExactly(EstadoPago.PENDIENTE);
    }

    @Test
    void compraInexistenteYCompraSinPagosResponden404() throws Exception {
        mvc.perform(get("/compras/{id}/pago", UUID.randomUUID()).header("Authorization", bearer(dueno)))
                .andExpect(status().isNotFound());
        consultar(compra("1500.00"), dueno).andExpect(status().isNotFound());
    }

    @Test
    void ignoraTarjetaEImporteEnviadosPorElCliente() throws Exception {
        Compra compra = compra("2500.00");

        mvc.perform(post("/compras/{id}/pago/simulacion", compra.getId())
                        .header("Authorization", bearer(dueno))
                        .header("Idempotency-Key", "clave-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"escenario": "APROBADO", "monto": 1,
                                 "numeroTarjeta": "4111111111111111", "cvv": "123"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.monto").value(2500.00))
                .andExpect(jsonPath("$.numeroTarjeta").doesNotExist());
    }

    @Test
    void validaClaveDeIdempotenciaYEscenario() throws Exception {
        Compra compra = compra("1500.00");

        mvc.perform(post("/compras/{id}/pago/simulacion", compra.getId())
                        .header("Authorization", bearer(dueno))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"escenario\":\"APROBADO\"}"))
                .andExpect(status().isBadRequest());
        simular(compra, dueno, "clave con espacios", "APROBADO").andExpect(status().isBadRequest());
        simular(compra, dueno, "x".repeat(101), "APROBADO").andExpect(status().isBadRequest());
        simular(compra, dueno, "clave-1", "REEMBOLSADO").andExpect(status().isBadRequest());
        mvc.perform(post("/compras/{id}/pago/simulacion", compra.getId())
                        .header("Authorization", bearer(dueno)).header("Idempotency-Key", "clave-1")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());

        assertThat(pagosDe(compra)).isEmpty();
    }

    @Test
    void sinJwtResponde401() throws Exception {
        Compra compra = compra("1500.00");

        mvc.perform(post("/compras/{id}/pago/simulacion", compra.getId())
                        .header("Idempotency-Key", "clave-1")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"escenario\":\"APROBADO\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/compras/{id}/pago", compra.getId())).andExpect(status().isUnauthorized());
    }

    private Compra compra(String monto) {
        return compras.saveAndFlush(new Compra(dueno, new BigDecimal(monto)));
    }

    private java.util.List<Pago> pagosDe(Compra compra) {
        return pagos.findByCompraIdOrderByCreatedAtAsc(compra.getId());
    }

    private ResultActions simular(Compra compra, UUID usuario, String clave, String escenario) throws Exception {
        return mvc.perform(post("/compras/{id}/pago/simulacion", compra.getId())
                .header("Authorization", bearer(usuario))
                .header("Idempotency-Key", clave)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"escenario\":\"%s\"}".formatted(escenario)));
    }

    private ResultActions consultar(Compra compra, UUID usuario) throws Exception {
        return mvc.perform(get("/compras/{id}/pago", compra.getId()).header("Authorization", bearer(usuario)));
    }

    private static String id(ResultActions result) throws Exception {
        return JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.pagoId");
    }

    private static String bearer(UUID usuario) {
        return "Bearer " + sign(claims().subject(usuario.toString()).build(), KEYS, JWSAlgorithm.RS256);
    }
}
