package cl.cloudcoffee.order_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoPago;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-76: POST/GET /compras/{id}/pago conforme al contrato de INT2-50 (#112). */
@SpringBootTest(properties = "management.tracing.enabled=false")
@AutoConfigureMockMvc
class PagoSimuladoControllerTest extends JwtTestSupport {

    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;

    final UUID dueno = UUID.randomUUID();

    @ParameterizedTest
    @CsvSource({
            "aprobar,   aprobado,  aprobacion_simulada",
            "rechazar,  rechazado, rechazo_simulado",
            "pendiente, pendiente, escenario_pendiente"
    })
    void cadaEscenarioCreaElPagoConformeAlContrato(String escenario, String estado, String motivo) throws Exception {
        Compra compra = compra("3700.00");

        pagar(compra, dueno, clave(), escenario)
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "/v1/compras/" + compra.getId() + "/pago"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().doesNotExist("Idempotency-Replayed"))
                .andExpect(jsonPath("$.pagoId").isNotEmpty())
                .andExpect(jsonPath("$.compraId").value(compra.getId().toString()))
                .andExpect(jsonPath("$.estado").value(estado))
                .andExpect(jsonPath("$.motivo").value(motivo))
                .andExpect(jsonPath("$.montoTotal").value(3700))
                .andExpect(jsonPath("$.moneda").value("CLP"))
                .andExpect(jsonPath("$.simulado").value(true))
                .andExpect(jsonPath("$.proveedor").value("simulado"))
                .andExpect(jsonPath("$.creadoAt").isNotEmpty())
                .andExpect(jsonPath("$.actualizadoAt").isNotEmpty())
                .andExpect(jsonPath("$.version").isNumber())
                // Sin proveedor externo: nada de redirecciones ni campos de tarjeta.
                .andExpect(jsonPath("$.initPoint").doesNotExist())
                .andExpect(jsonPath("$.length()").value(11));

        consultar(compra, dueno)
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.estado").value(estado))
                .andExpect(jsonPath("$.motivo").value(motivo));
    }

    @Test
    void laConsultaCoincideConLaRespuestaDeCreacion() throws Exception {
        Compra compra = compra("1500.00");
        String creado = pagar(compra, dueno, clave(), "pendiente")
                .andExpect(jsonPath("$.version").value(1))
                .andReturn().getResponse().getContentAsString();

        String consultado = consultar(compra, dueno).andReturn().getResponse().getContentAsString();

        // Mismas fechas (precisión de la base) y versión: nada cambió entre ambas lecturas.
        assertThat(consultado).isEqualTo(creado);
    }

    @ParameterizedTest
    @ValueSource(strings = {"aprobar", "rechazar", "pendiente"})
    void repetirLaClaveReproduceElCodigoYElCuerpoOriginales(String escenario) throws Exception {
        Compra compra = compra("1500.00");
        String clave = clave();
        MvcResult original = pagar(compra, dueno, clave, escenario).andExpect(status().isCreated()).andReturn();

        MvcResult repetido = pagar(compra, dueno, clave, escenario)
                .andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andExpect(header().string("Location", original.getResponse().getHeader("Location")))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andReturn();

        assertThat(repetido.getResponse().getContentAsString())
                .isEqualTo(original.getResponse().getContentAsString());
        assertThat(pagos.findByCompraId(compra.getId())).isPresent();
    }

    @Test
    void laMismaClaveConOtroEscenarioEsUnConflicto() throws Exception {
        Compra compra = compra("1500.00");
        String clave = clave();
        pagar(compra, dueno, clave, "rechazar").andExpect(status().isCreated());

        pagar(compra, dueno, clave, "aprobar")
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));

        assertThat(estado(compra)).isEqualTo(EstadoPago.RECHAZADO);
    }

    @ParameterizedTest
    @ValueSource(strings = {"aprobar", "rechazar", "pendiente"})
    void unPendienteNoSeResuelveConOtroEscenarioYOtraClave(String otroEscenario) throws Exception {
        Compra compra = compra("1500.00");
        pagar(compra, dueno, clave(), "pendiente").andExpect(status().isCreated());

        pagar(compra, dueno, clave(), otroEscenario)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PAGO_YA_INICIADO"));

        assertThat(estado(compra)).isEqualTo(EstadoPago.PENDIENTE);
        consultar(compra, dueno).andExpect(jsonPath("$.estado").value("pendiente"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"aprobar", "rechazar"})
    void unPagoTerminadoNoSeReemplazaConOtraClave(String escenario) throws Exception {
        Compra compra = compra("1500.00");
        String pagoId = pagoId(pagar(compra, dueno, clave(), escenario).andExpect(status().isCreated()));

        pagar(compra, dueno, clave(), "aprobar")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PAGO_YA_INICIADO"));

        assertThat(pagos.findByCompraId(compra.getId())).get()
                .extracting(pago -> pago.getId().toString()).isEqualTo(pagoId);
    }

    @Test
    void otroClienteNoPagaNiConsultaNiReproduceLaCompra() throws Exception {
        Compra compra = compra("1500.00");
        UUID ajeno = UUID.randomUUID();
        String clave = clave();

        pagar(compra, ajeno, clave, "aprobar").andExpect(status().isNotFound());
        pagar(compra, dueno, clave, "pendiente").andExpect(status().isCreated());
        // Con la misma clave que usó el dueño, el ajeno tampoco ve el resultado.
        pagar(compra, ajeno, clave, "pendiente").andExpect(status().isNotFound());
        consultar(compra, ajeno).andExpect(status().isNotFound());

        assertThat(estado(compra)).isEqualTo(EstadoPago.PENDIENTE);
    }

    @ParameterizedTest
    @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void soloUnClientePuedePagar(String role) throws Exception {
        Compra compra = compra("1500.00");
        String jwt = "Bearer " + sign(claims().subject(dueno.toString()).claim("role", role).build(),
                KEYS, JWSAlgorithm.RS256);

        mvc.perform(post("/compras/{id}/pago", compra.getId()).header("Authorization", jwt)
                        .header("Idempotency-Key", clave()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"escenario\":\"aprobar\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));

        assertThat(pagos.findByCompraId(compra.getId())).isEmpty();
    }

    @Test
    void compraInexistenteYCompraSinPagoResponden404() throws Exception {
        mvc.perform(get("/compras/{id}/pago", UUID.randomUUID()).header("Authorization", bearer(dueno)))
                .andExpect(status().isNotFound());
        consultar(compra("1500.00"), dueno)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PAGO_NO_ENCONTRADO"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "{\"escenario\":\"aprobar\",\"montoTotal\":1}",
            "{\"escenario\":\"aprobar\",\"numeroTarjeta\":\"4111111111111111\"}",
            "{\"escenario\":\"APROBADO\"}",
            "{\"escenario\":\"reembolsar\"}",
            "{}"
    })
    void soloAceptaElEscenarioDelContrato(String cuerpo) throws Exception {
        Compra compra = compra("1500.00");

        mvc.perform(post("/compras/{id}/pago", compra.getId()).header("Authorization", bearer(dueno))
                        .header("Idempotency-Key", clave()).contentType(MediaType.APPLICATION_JSON).content(cuerpo))
                .andExpect(status().isBadRequest());

        assertThat(pagos.findByCompraId(compra.getId())).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"clave-1", "123", "not-a-uuid-at-all"})
    void laClaveDebeSerUnUuid(String clave) throws Exception {
        Compra compra = compra("1500.00");

        pagar(compra, dueno, clave, "aprobar").andExpect(status().isBadRequest());
        mvc.perform(post("/compras/{id}/pago", compra.getId()).header("Authorization", bearer(dueno))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"escenario\":\"aprobar\"}"))
                .andExpect(status().isBadRequest());

        assertThat(pagos.findByCompraId(compra.getId())).isEmpty();
    }

    @Test
    void sinJwtResponde401() throws Exception {
        Compra compra = compra("1500.00");

        mvc.perform(post("/compras/{id}/pago", compra.getId()).header("Idempotency-Key", clave())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"escenario\":\"aprobar\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/compras/{id}/pago", compra.getId())).andExpect(status().isUnauthorized());
    }

    private Compra compra(String monto) {
        return compras.saveAndFlush(new Compra(dueno, new BigDecimal(monto)));
    }

    private EstadoPago estado(Compra compra) {
        return pagos.findByCompraId(compra.getId()).map(Pago::getEstado).orElseThrow();
    }

    private ResultActions pagar(Compra compra, UUID usuario, String clave, String escenario) throws Exception {
        return mvc.perform(post("/compras/{id}/pago", compra.getId())
                .header("Authorization", bearer(usuario))
                .header("Idempotency-Key", clave)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"escenario\":\"%s\"}".formatted(escenario)));
    }

    private ResultActions consultar(Compra compra, UUID usuario) throws Exception {
        return mvc.perform(get("/compras/{id}/pago", compra.getId()).header("Authorization", bearer(usuario)));
    }

    private static String pagoId(ResultActions result) throws Exception {
        return com.jayway.jsonpath.JsonPath.read(result.andReturn().getResponse().getContentAsString(), "$.pagoId");
    }

    private static String clave() {
        return UUID.randomUUID().toString();
    }

    private static String bearer(UUID usuario) {
        return "Bearer " + sign(claims().subject(usuario.toString()).build(), KEYS, JWSAlgorithm.RS256);
    }
}
