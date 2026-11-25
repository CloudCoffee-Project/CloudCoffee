package cl.cloudcoffee.order_service.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.EstadoOrden;
import cl.cloudcoffee.order_service.model.Orden;
import cl.cloudcoffee.order_service.model.OrdenItem;
import cl.cloudcoffee.order_service.model.Pago;
import cl.cloudcoffee.order_service.repository.CompraRepository;
import cl.cloudcoffee.order_service.repository.PagoRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;

/** INT2-129: Auth consulta si un usuario tiene compras sin cerrar antes de su baja. */
@SpringBootTest(properties = "management.tracing.enabled=false")
@AutoConfigureMockMvc
class InternalComprasEnCursoControllerTest extends JwtTestSupport {

    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;
    @Autowired JdbcTemplate jdbc;

    final UUID cliente = UUID.randomUUID();

    @Test
    void withoutPurchasesNothingIsInProgress() throws Exception {
        consultar(cliente).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.usuarioId").value(cliente.toString()))
                .andExpect(jsonPath("$.enCurso").value(false))
                .andExpect(jsonPath("$.compras").value(0));
    }

    @Test
    void purchasesUnderReviewOrAwaitingPaymentAreInProgress() throws Exception {
        Compra compra = compra(cliente);
        jdbc.update("UPDATE compras SET estado='PENDIENTE_PAGO' WHERE id=?", compra.getId());
        enCurso(cliente, 1);
        jdbc.update("UPDATE compras SET estado='REVISION_REQUERIDA' WHERE id=?", compra.getId());
        enCurso(cliente, 1);
        // Las compras de otro usuario no cuentan.
        enCurso(UUID.randomUUID(), 0);
    }

    @Test
    void paidOrdersCountUntilDeliveredOrClosed() throws Exception {
        Compra compra = compra(cliente);
        pagado(compra, "APROBADO");
        for (String abierta : List.of("PAGADO", "LISTO_PARA_RETIRO", "NO_RETIRADO_PENDIENTE_REVISION")) {
            jdbc.update("UPDATE ordenes SET estado=? WHERE compra_id=?", abierta, compra.getId());
            enCurso(cliente, 1);
        }
        jdbc.update("UPDATE ordenes SET estado='ENTREGADO' WHERE compra_id=?", compra.getId());
        enCurso(cliente, 0);
        jdbc.update("UPDATE ordenes SET estado='NO_RETIRADO_FINAL' WHERE compra_id=?", compra.getId());
        enCurso(cliente, 0);
    }

    @Test
    void anUnresolvedPaymentKeepsThePurchaseInProgress() throws Exception {
        Compra compra = compra(cliente);
        pagado(compra, "REQUIERE_CONCILIACION");
        jdbc.update("UPDATE ordenes SET estado='ENTREGADO' WHERE compra_id=?", compra.getId());
        enCurso(cliente, 1);
    }

    @Test
    void cancelledPurchasesWithAClosedPaymentDoNotBlock() throws Exception {
        Compra compra = compra(cliente);
        pagos.saveAndFlush(new Pago(compra, "SIMULADO", null));
        jdbc.update("UPDATE pagos SET estado='RECHAZADO' WHERE compra_id=?", compra.getId());
        jdbc.update("UPDATE compras SET estado='CANCELADO', monto_total=0 WHERE id=?", compra.getId());
        jdbc.update("UPDATE ordenes SET estado='CANCELADO' WHERE compra_id=?", compra.getId());
        enCurso(cliente, 0);
        // Dos compras abiertas se cuentan por separado.
        compra(cliente);
        compra(cliente);
        enCurso(cliente, 2);
    }

    @Test
    void onlyTheInternalTokenCanAsk() throws Exception {
        mvc.perform(get(ruta(cliente))).andExpect(status().isUnauthorized());
        for (String rol : List.of("CLIENTE", "SUPER_ADMIN")) {
            mvc.perform(get(ruta(cliente)).header("Authorization", "Bearer " + sign(
                    claims().subject(cliente.toString()).claim("role", rol).build(), KEYS, JWSAlgorithm.RS256)))
                    .andExpect(status().isForbidden());
        }
        mvc.perform(get(ruta(cliente)).header("X-Internal-Service-Token", "otro-token-de-servicio-con-32-caracteres"))
                .andExpect(status().isUnauthorized());
    }

    private Compra compra(UUID dueno) {
        Orden orden = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Central", EstadoOrden.PENDIENTE_PAGO,
                List.of(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Café", 1, new BigDecimal("1800"))));
        return compras.saveAndFlush(new Compra(dueno, Instant.now(), List.of(orden)));
    }

    private void pagado(Compra compra, String estadoPago) {
        pagos.saveAndFlush(new Pago(compra, "SIMULADO", null));
        jdbc.update("UPDATE pagos SET estado=? WHERE compra_id=?", estadoPago, compra.getId());
        jdbc.update("UPDATE compras SET estado='PAGADO' WHERE id=?", compra.getId());
        jdbc.update("UPDATE ordenes SET estado='PAGADO' WHERE compra_id=?", compra.getId());
    }

    private void enCurso(UUID usuario, int esperadas) throws Exception {
        consultar(usuario).andExpect(status().isOk())
                .andExpect(jsonPath("$.enCurso").value(esperadas > 0))
                .andExpect(jsonPath("$.compras").value(esperadas));
    }

    private ResultActions consultar(UUID usuario) throws Exception {
        return mvc.perform(get(ruta(usuario)).header("X-Internal-Service-Token", INTERNAL_TOKEN));
    }

    private static String ruta(UUID usuario) {
        return "/internal/servicios/compras/usuarios/" + usuario + "/en-curso";
    }
}
