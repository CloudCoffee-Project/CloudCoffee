package cl.cloudcoffee.order_service.controller;

import static cl.cloudcoffee.order_service.persistence.JdbcInstants.utc;
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
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest(properties = {
        "management.tracing.enabled=false", "spring.jpa.open-in-view=false",
        "spring.jpa.properties.hibernate.query.fail_on_pagination_over_collection_fetch=true"})
@AutoConfigureMockMvc
class ConsultaVentasControllerTest extends JwtTestSupport {
    private static final String VENTAS = "/orders/ventas";
    private static final String PERIODO = "?desde=2026-04-04&hasta=2026-04-04";
    private static final Instant INICIO = Instant.parse("2026-04-04T03:00:00Z");
    private static final Instant FIN_EXCLUSIVO = Instant.parse("2026-04-05T04:00:00Z");

    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean AsignacionesCafeteria asignaciones;

    private final UUID central = UUID.randomUUID();
    private final UUID norte = UUID.randomUUID();
    private final UUID campus = UUID.randomUUID();
    private final UUID admin = UUID.randomUUID();

    @BeforeEach
    void autenticarEnCafeteriaPersistida() {
        when(asignaciones.cafeteriaDe(admin)).thenReturn(Optional.of(central));
    }

    @Test
    void totalizaUnaSolaVezLasOrdenesPropiasPagadasInclusoSiNoFueronRetiradas() throws Exception {
        Compra compra = compra("PAGADO", INICIO);
        Orden propia = compra.getOrdenes().getFirst();
        compra("NO_RETIRADO_FINAL", INICIO.plusSeconds(10));
        compra("CANCELADO", null);
        compra("PENDIENTE_PAGO", null);

        consultar(VENTAS + PERIODO + "&size=1")
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.content[0].estado").value("no_retirado_final"));
        consultar(VENTAS + PERIODO + "&size=1&page=1")
                .andExpect(jsonPath("$.content[0].ordenId").value(propia.getId().toString()))
                .andExpect(jsonPath("$.content[0].cafeteriaId").value(central.toString()))
                .andExpect(jsonPath("$.content[0].campusId").value(campus.toString()))
                .andExpect(jsonPath("$.content[0].pagadoAt").value(INICIO.toString()))
                .andExpect(jsonPath("$.content[0].cantidadItems").value(2))
                .andExpect(jsonPath("$.content[0].montoTotal").value(2700))
                .andExpect(jsonPath("$.content[0].clienteId").doesNotExist());
        consultar(VENTAS + "/resumen" + PERIODO)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.moneda").value("CLP"))
                .andExpect(jsonPath("$.ordenes").value(2))
                .andExpect(jsonPath("$.montoTotal").value(5400))
                .andExpect(jsonPath("$.porEstado.length()").value(2))
                .andExpect(jsonPath("$.porCafeteria.length()").value(1))
                .andExpect(jsonPath("$.porCafeteria[0].cafeteriaId").value(central.toString()))
                .andExpect(jsonPath("$.porCafeteria[0].montoTotal").value(5400));
        consultar(VENTAS + "/resumen" + PERIODO + "&estado=no_retirado_final")
                .andExpect(jsonPath("$.ordenes").value(1))
                .andExpect(jsonPath("$.montoTotal").value(2700))
                .andExpect(jsonPath("$.porEstado[0].estado").value("no_retirado_final"));
        consultar(VENTAS + PERIODO + "&estado=no_retirado_final")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].estado").value("no_retirado_final"));
        consultar(VENTAS + PERIODO + "&page=2147483647&size=100")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    void usaFechaDePagoYLosLimitesLocalesInclusoEnUnDiaDeVeinticincoHoras() throws Exception {
        compra("PAGADO", INICIO.minusNanos(1_000));
        var inicial = compra("PAGADO", INICIO).getOrdenes().getFirst();
        var finalDelDia = compra("PAGADO", FIN_EXCLUSIVO.minusSeconds(1)).getOrdenes().getFirst();
        compra("PAGADO", FIN_EXCLUSIVO);

        consultar(VENTAS + PERIODO)
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].ordenId").value(finalDelDia.getId().toString()))
                .andExpect(jsonPath("$.content[1].ordenId").value(inicial.getId().toString()));
        consultar(VENTAS + "?desde=2026-01-01&hasta=2026-04-02").andExpect(status().isOk());
        consultar(VENTAS + "?desde=2026-01-01&hasta=2026-04-03")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("RANGO_VENTAS_INVALIDO"));
    }

    @Test
    void detalleIncluyeSnapshotsDeItemsYPreservaLaPrivacidadDeOtrasOrdenes() throws Exception {
        var compra = compra("ENTREGADO", INICIO);
        Orden propia = compra.getOrdenes().getFirst();
        Orden ajena = compra.getOrdenes().getLast();
        Orden cancelada = compra("CANCELADO", null).getOrdenes().getFirst();
        consultar(VENTAS + "/" + propia.getId())
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.venta.compraId").value(compra.getId().toString()))
                .andExpect(jsonPath("$.venta.montoTotal").value(2700))
                .andExpect(jsonPath("$.venta.usuarioId").doesNotExist())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[?(@.productoNombre=='Café histórico')].subtotal").value(1800));
        for (UUID id : List.of(ajena.getId(), cancelada.getId(), UUID.randomUUID())) {
            consultar(VENTAS + "/" + id).andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("ORDEN_NO_ENCONTRADA"));
        }
    }

    @Test
    void asignacionActualMandaSobreElClaimYUnaCafeteriaSolicitadaDebeCoincidir() throws Exception {
        var compra = compra("PAGADO", INICIO);
        consultar(VENTAS + PERIODO + "&cafeteriaId=" + norte).andExpect(status().isForbidden());
        consultar(VENTAS + "/resumen" + PERIODO + "&cafeteriaId=" + norte).andExpect(status().isForbidden());
        consultar(VENTAS + PERIODO + "&cafeteriaId=" + central).andExpect(status().isOk());
        when(asignaciones.cafeteriaDe(admin)).thenReturn(Optional.of(norte));
        consultar(VENTAS + PERIODO).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].ordenId").value(compra.getOrdenes().getLast().getId().toString()));
        when(asignaciones.cafeteriaDe(admin)).thenReturn(Optional.empty());
        consultar(VENTAS + PERIODO).andExpect(status().isForbidden());
        when(asignaciones.cafeteriaDe(admin)).thenThrow(new AsignacionNoVerificableException("Auth no responde", null));
        consultar(VENTAS + "/resumen" + PERIODO).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ASIGNACION_NO_AUTORIZADA"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "SUPER_ADMIN", "CAJERO"})
    void requiereJwtYRolDeAdministradorDeCafeteria(String rol) throws Exception {
        for (String ruta : List.of(VENTAS, VENTAS + "/resumen", VENTAS + "/" + UUID.randomUUID())) {
            mvc.perform(get(ruta)).andExpect(status().isUnauthorized());
            mvc.perform(get(ruta).header("Authorization", bearer(rol))).andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"?desde=2026-04-05&hasta=2026-04-04", "?desde=2026-02-30",
            "?estado=cancelado", "?estado=pendiente_pago", "?page=-1", "?size=101"})
    void invalidaFiltrosYLimitesDesconocidos(String consulta) throws Exception {
        consultar(VENTAS + consulta).andExpect(status().isBadRequest());
    }

    private Compra compra(String estado, Instant pagadoAt) {
        Orden primera = orden(central, "Central histórica", List.of(item("Café histórico", 2, 900), item("Té", 1, 900)));
        Orden segunda = orden(norte, "Norte histórica", List.of(item("Pan", 1, 9400)));
        var compra = compras.saveAndFlush(new Compra(UUID.randomUUID(), INICIO.minusSeconds(4_000),
                List.of(primera, segunda)));
        jdbc.update("UPDATE ordenes SET estado=?, pagado_at=?, campus_id=? WHERE compra_id=?",
                estado, pagadoAt == null ? null : utc(pagadoAt), campus, compra.getId());
        return compra;
    }

    private static Orden orden(UUID cafeteria, String nombre, List<OrdenItem> items) {
        return new Orden("CC-" + UUID.randomUUID(), cafeteria, nombre, EstadoOrden.PENDIENTE_PAGO, items);
    }

    private static OrdenItem item(String nombre, int cantidad, long precio) {
        return new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), nombre, cantidad, BigDecimal.valueOf(precio));
    }

    private ResultActions consultar(String ruta) throws Exception {
        return mvc.perform(get(ruta).header("Authorization", bearer("ADMIN_CAFETERIA")));
    }

    private String bearer(String rol) {
        var claims = claims().subject(admin.toString()).claim("role", rol);
        if ("ADMIN_CAFETERIA".equals(rol)) {
            claims.claim("cafeteriaId", norte.toString());
        }
        return "Bearer " + sign(claims.build(), KEYS, JWSAlgorithm.RS256);
    }
}
