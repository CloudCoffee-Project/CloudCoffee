package cl.cloudcoffee.order_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.Orden;
import cl.cloudcoffee.order_service.model.OrdenItem;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.security.AsignacionNoVerificableException;
import cl.cloudcoffee.security.AsignacionesCafeteria;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import jakarta.persistence.EntityManagerFactory;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/** HTTP con JWT firmado y persistencia real; Auth simulado solo para la asignación. */
@SpringBootTest(properties = {
        "management.tracing.enabled=false", "spring.jpa.open-in-view=false",
        "spring.jpa.properties.hibernate.generate_statistics=true",
        "spring.jpa.properties.hibernate.query.fail_on_pagination_over_collection_fetch=true"})
@AutoConfigureMockMvc
class ConsultaOrdenesControllerTest extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManagerFactory entityManagerFactory;
    @MockitoBean AsignacionesCafeteria asignaciones;

    final UUID central = UUID.randomUUID();
    final UUID norte = UUID.randomUUID();
    final UUID cajero = UUID.randomUUID();
    final UUID otroCajero = UUID.randomUUID();
    final UUID comprador = UUID.randomUUID();
    static final Instant FECHA = Instant.parse("2026-10-01T12:00:00Z");

    @BeforeEach
    void asignacionesPersistidas() {
        when(asignaciones.cafeteriaDe(any())).thenReturn(Optional.empty());
        when(asignaciones.cafeteriaDe(cajero)).thenReturn(Optional.of(central));
        when(asignaciones.cafeteriaDe(otroCajero)).thenReturn(Optional.of(norte));
    }

    @Test
    void paginaSoloSuCafeteriaConDesempatePorIdYTodosLosItems() throws Exception {
        Orden anterior = compra(FECHA.minusSeconds(1)).getOrdenes().getFirst();
        Orden primera = compra(FECHA).getOrdenes().getFirst();
        Orden segunda = compra(FECHA).getOrdenes().getFirst();
        var ids = new ArrayList<>(List.of(primera.getId().toString(), segunda.getId().toString()));
        ids.sort(Comparator.reverseOrder());

        // Ni parámetros, encabezados, orden solicitado ni el claim reemplazan a Auth.
        mvc.perform(get("/orders").param("page", "0").param("size", "2")
                .param("cafeteriaId", norte.toString()).param("clienteId", comprador.toString())
                .param("sort", "createdAt,asc").header("X-Cafeteria-Id", norte.toString())
                .header("Authorization", bearer(cajero, "CAJERO", norte)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.length()").value(8))
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].ordenId").value(ids.get(0)))
                .andExpect(jsonPath("$.content[1].ordenId").value(ids.get(1)))
                .andExpect(jsonPath("$.content[0].cafeteriaId").value(central.toString()))
                .andExpect(jsonPath("$.content[1].cafeteriaId").value(central.toString()))
                .andExpect(jsonPath("$.content[0].length()").value(15))
                .andExpect(jsonPath("$.content[0].items.length()").value(2))
                .andExpect(jsonPath("$.number").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.first").value(true))
                .andExpect(jsonPath("$.last").value(false))
                .andExpect(jsonPath("$.empty").value(false));

        consultar("/orders?page=1&size=2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].ordenId").value(anterior.getId().toString()))
                .andExpect(jsonPath("$.first").value(false))
                .andExpect(jsonPath("$.last").value(true));
        for (int page : List.of(8, Integer.MAX_VALUE)) {
            consultar("/orders?page=" + page + "&size=100")
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content").isEmpty())
                    .andExpect(jsonPath("$.number").value(page))
                    .andExpect(jsonPath("$.totalElements").value(3))
                    .andExpect(jsonPath("$.last").value(true))
                    .andExpect(jsonPath("$.empty").value(true));
        }
    }

    @Test
    void busquedaManualExactaSoloEncuentraCodigosDeLaCafeteriaAsignada() throws Exception {
        Compra compra = compra(FECHA);
        Orden propia = compra.getOrdenes().getFirst();
        Orden ajena = compra.getOrdenes().getLast();

        mvc.perform(get("/orders").param("codigoOrden", "  " + propia.getCodigoOrden() + "  ")
                .header("Authorization", bearer(cajero, "CAJERO", null)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].ordenId").value(propia.getId().toString()))
                .andExpect(jsonPath("$.content[0].codigoOrden").value(propia.getCodigoOrden()))
                .andExpect(jsonPath("$.totalElements").value(1));
        for (String codigo : List.of(ajena.getCodigoOrden(), "CC-INEXISTENTE", "CC-%", "CC-_",
                propia.getCodigoOrden().substring(0, 10))) {
            mvc.perform(get("/orders").param("codigoOrden", codigo)
                    .header("Authorization", bearer(cajero, "CAJERO", null)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content").isEmpty())
                    .andExpect(jsonPath("$.totalElements").value(0));
        }
        // El cajero Norte sí encuentra la orden Norte, pero no la de Central.
        mvc.perform(get("/orders").param("codigoOrden", propia.getCodigoOrden())
                .header("Authorization", bearer(otroCajero, "CAJERO", central)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content").isEmpty());
        mvc.perform(get("/orders").header("Authorization", bearer(otroCajero, "CAJERO", central)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].ordenId").value(ajena.getId().toString()));
    }

    @Test
    void combinaEstadoYCodigoSinModificarSnapshotsNiEstados() throws Exception {
        Orden lista = compra(FECHA).getOrdenes().getFirst();
        compra(FECHA.plusSeconds(1));
        jdbc.update("UPDATE ordenes SET estado='LISTO_PARA_RETIRO', retiro_hasta=?, version=2 WHERE id=?",
                java.sql.Timestamp.from(FECHA.plusSeconds(7200)), lista.getId());
        var antes = jdbc.queryForMap("SELECT * FROM ordenes WHERE id=?", lista.getId());

        for (String ruta : List.of("/orders?estado=listo_para_retiro",
                "/orders?estado=listo_para_retiro&codigoOrden=" + lista.getCodigoOrden())) {
            consultar(ruta).andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.content[0].ordenId").value(lista.getId().toString()))
                    .andExpect(jsonPath("$.content[0].estado").value("listo_para_retiro"))
                    .andExpect(jsonPath("$.content[0].cafeteriaNombre").value("Central histórica"))
                    .andExpect(jsonPath("$.content[0].montoTotal").value(2700))
                    .andExpect(jsonPath("$.content[0].retiroHasta").value(FECHA.plusSeconds(7200).toString()))
                    .andExpect(jsonPath("$.content[0].version").value(3));
        }
        consultar("/orders?estado=pendiente_pago&codigoOrden=" + lista.getCodigoOrden())
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalElements").value(0));
        assertThat(jdbc.queryForMap("SELECT * FROM ordenes WHERE id=?", lista.getId())).isEqualTo(antes);
    }

    @Test
    void sinPedidosDevuelvePaginaVaciaConPredeterminados() throws Exception {
        consultar("/orders").andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.number").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.totalPages").value(0))
                .andExpect(jsonPath("$.first").value(true))
                .andExpect(jsonPath("$.last").value(true))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void compradorYAdministradoresNoPuedenListarNiBuscarPedidos(String rol) throws Exception {
        Compra compra = compra(FECHA);
        for (String ruta : List.of("/orders", "/orders?codigoOrden=" + compra.getOrdenes().getFirst().getCodigoOrden())) {
            mvc.perform(get(ruta).header("Authorization", bearer(comprador, rol, null)))
                    .andExpect(status().isForbidden())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                    .andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
        }
        verifyNoInteractions(asignaciones);
    }

    @Test
    void sinAsignacionOConAuthCaidoFallaCerradoAunqueElJwtTraigaCafeteria() throws Exception {
        Orden orden = compra(FECHA).getOrdenes().getFirst();
        for (boolean authCaido : List.of(false, true)) {
            if (authCaido) {
                when(asignaciones.cafeteriaDe(cajero))
                        .thenThrow(new AsignacionNoVerificableException("Auth no responde", null));
            } else {
                when(asignaciones.cafeteriaDe(cajero)).thenReturn(Optional.empty());
            }
            for (String ruta : List.of("/orders", "/orders?codigoOrden=" + orden.getCodigoOrden())) {
                mvc.perform(get(ruta).header("Authorization", bearer(cajero, "CAJERO", central)))
                        .andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.code").value("ASIGNACION_NO_AUTORIZADA"));
            }
        }
    }

    @Test
    void cambioDeAsignacionRigeEnLaSiguienteSolicitudConElMismoJwt() throws Exception {
        Compra compra = compra(FECHA);
        String jwt = bearer(cajero, "CAJERO", central);
        mvc.perform(get("/orders").header("Authorization", jwt))
                .andExpect(jsonPath("$.content[0].cafeteriaId").value(central.toString()));
        when(asignaciones.cafeteriaDe(cajero)).thenReturn(Optional.of(norte));
        mvc.perform(get("/orders").header("Authorization", jwt)).andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].ordenId").value(compra.getOrdenes().getLast().getId().toString()));
        when(asignaciones.cafeteriaDe(cajero)).thenReturn(Optional.empty());
        mvc.perform(get("/orders").header("Authorization", jwt)).andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @CsvSource({"-1,20", "0,0", "0,-1", "0,101"})
    void validaLimitesDePaginacion(int page, int size) throws Exception {
        consultar("/orders?page=" + page + "&size=" + size)
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("PAGINACION_INVALIDA"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/orders?page=abc", "/orders?size=abc", "/orders?page=2147483648",
            "/orders?estado=desconocido", "/orders?estado=LISTO_PARA_RETIRO", "/orders?estado="})
    void parametrosMalformadosSon400(String ruta) throws Exception {
        consultar(ruta).andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"})
    void codigoVacioOLargoEs400(String codigo) throws Exception {
        mvc.perform(get("/orders").param("codigoOrden", codigo)
                .header("Authorization", bearer(cajero, "CAJERO", null)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("CODIGO_ORDEN_INVALIDO"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"expired", "tampered", "wrong-key", "malformed"})
    void jwtAusenteOInvalidoNoPermiteListarNiBuscar(String tipo) throws Exception {
        for (String ruta : List.of("/orders", "/orders?codigoOrden=CC-000001")) {
            mvc.perform(get(ruta)).andExpect(status().isUnauthorized());
            mvc.perform(get(ruta).header("Authorization", "Bearer " + invalidToken(tipo)))
                    .andExpect(status().isUnauthorized());
        }
        verifyNoInteractions(asignaciones);
    }

    @Test
    void subjectNoUuidEs403AntesDeConsultarLaAsignacion() throws Exception {
        String jwt = sign(claims().subject("no-es-uuid").claim("role", "CAJERO").build(), KEYS, JWSAlgorithm.RS256);
        mvc.perform(get("/orders").header("Authorization", "Bearer " + jwt))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("USUARIO_INVALIDO"));
        verifyNoInteractions(asignaciones);
    }

    @Test
    void cargaLosItemsEnLoteSinConsultasPorOrden() throws Exception {
        for (int i = 0; i < 4; i++) compra(FECHA.plusSeconds(i));
        var stats = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        stats.clear();
        consultar("/orders?size=3").andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[2].items.length()").value(2));
        assertThat(stats.getPrepareStatementCount()).isLessThanOrEqualTo(3);
    }

    private Compra compra(Instant fecha) {
        Orden centralOrden = new Orden("CC-" + UUID.randomUUID(), central, "Central histórica",
                EstadoOrden.PENDIENTE_PAGO, List.of(item("Café", "1800"), item("Té", "900")));
        Orden norteOrden = new Orden("CC-" + UUID.randomUUID(), norte, "Norte histórica",
                EstadoOrden.REVISION_REQUERIDA, List.of(item("Té Norte", "900")));
        return compras.saveAndFlush(new Compra(comprador, fecha, List.of(centralOrden, norteOrden)));
    }

    private OrdenItem item(String nombre, String precio) {
        return new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), nombre, 1, new BigDecimal(precio));
    }

    private ResultActions consultar(String ruta) throws Exception {
        return mvc.perform(get(ruta).header("Authorization", bearer(cajero, "CAJERO", central)));
    }

    private static String bearer(UUID usuario, String rol, UUID cafeteriaClaim) {
        var claims = claims().subject(usuario.toString()).claim("role", rol);
        if (cafeteriaClaim != null) claims.claim("cafeteriaId", cafeteriaClaim.toString());
        return "Bearer " + sign(claims.build(), KEYS, JWSAlgorithm.RS256);
    }
}
