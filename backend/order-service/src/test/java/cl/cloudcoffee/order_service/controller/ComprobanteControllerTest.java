package cl.cloudcoffee.order_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import cl.cloudcoffee.order_service.comprobantes.ComprobanteService;
import cl.cloudcoffee.order_service.model.*;
import cl.cloudcoffee.order_service.repository.*;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import java.math.BigDecimal;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"management.tracing.enabled=false", "cloudcoffee.idempotencia.enabled=false"})
@AutoConfigureMockMvc
class ComprobanteControllerTest extends JwtTestSupport {
    @Autowired MockMvc mvc;
    @Autowired CompraRepository compras;
    @Autowired PagoRepository pagos;
    @Autowired JdbcTemplate jdbc;
    final UUID cliente = UUID.randomUUID();

    @Test
    void descargaPdfPropioConFolioEstableSnapshotsYPagoConfirmado() throws Exception {
        Compra compra = crear(true, 1);
        UUID id = compra.getOrdenes().getFirst().getId();
        byte[] primero = descargar(id);
        byte[] segundo = descargar(id);
        try (var a = Loader.loadPDF(primero); var b = Loader.loadPDF(segundo)) {
            String texto = new PDFTextStripper().getText(a);
            assertThat(texto).isEqualTo(new PDFTextStripper().getText(b));
            assertThat(texto).contains("Café histórico", "Central histórica", "2", "$1.800", "$3.600",
                    ComprobanteService.folio(id), "01/10/2026", "Sin validez tributaria");
            assertThat(texto).doesNotContain(cliente.toString(), "Bearer", "initPoint", "QR");
            Path salida = Path.of("target/comprobante-ejemplo.pdf"); Files.write(salida, primero);
            ImageIO.write(new PDFRenderer(a).renderImageWithDPI(0, 110), "png", Path.of("target/comprobante-ejemplo.png").toFile());
        }
    }

    @Test
    void ordenImpagaNoTieneComprobante() throws Exception {
        var compra = crear(false, 1);
        mvc.perform(get(ruta(compra.getOrdenes().getFirst().getId())).header("Authorization", bearer(cliente.toString(), "CLIENTE")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("COMPROBANTE_NO_DISPONIBLE"));
    }

    @Test
    void propietarioAjenoYOrdenInexistenteSon404() throws Exception {
        UUID id = crear(true, 1).getOrdenes().getFirst().getId();
        for (UUID orden : List.of(id, UUID.randomUUID())) mvc.perform(get(ruta(orden))
                .header("Authorization", bearer(UUID.randomUUID().toString(), "CLIENTE"))).andExpect(status().isNotFound());
    }

    @ParameterizedTest @ValueSource(strings = {"CAJERO", "ADMIN_CAFETERIA", "SUPER_ADMIN"})
    void otrosRolesNoDescarganComprobante(String role) throws Exception {
        mvc.perform(get(ruta(UUID.randomUUID())).header("Authorization", bearer(cliente.toString(), role)))
                .andExpect(status().isForbidden());
    }

    @Test
    void requiereJwtVigente() throws Exception {
        mvc.perform(get(ruta(UUID.randomUUID()))).andExpect(status().isUnauthorized());
        mvc.perform(get(ruta(UUID.randomUUID())).header("Authorization", "Bearer " + invalidToken("expired")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void compraMulticafeteriaTieneFoliosEImportesSeparados() throws Exception {
        var compra = crear(true, 2);
        UUID a = compra.getOrdenes().get(0).getId(), b = compra.getOrdenes().get(1).getId();
        try (var pdf = Loader.loadPDF(descargar(a))) {
            assertThat(new PDFTextStripper().getText(pdf)).contains(ComprobanteService.folio(a)).doesNotContain(ComprobanteService.folio(b), "$7.200");
        }
    }

    @Test
    void cienItemsLargosSePaginanSinPerderElTotal() throws Exception {
        var items = new ArrayList<OrdenItem>();
        for (int i = 0; i < 100; i++) items.add(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(),
                "Producto " + i + " Café con ñ y descripción ".repeat(8), 1, new BigDecimal("1500")));
        var orden = new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Cafetería " + "histórica ".repeat(20), EstadoOrden.PENDIENTE_PAGO, items);
        var compra = compras.saveAndFlush(new Compra(cliente, Instant.parse("2026-10-01T12:00:00Z"), List.of(orden)));
        pagar(compra);
        byte[] bytes = descargar(orden.getId());
        Files.write(Path.of("target/comprobante-largo.pdf"), bytes);
        try (var pdf = Loader.loadPDF(bytes)) {
            assertThat(pdf.getNumberOfPages()).isGreaterThan(1);
            assertThat(new PDFTextStripper().getText(pdf)).contains("TOTAL CLP", "$150.000");
            for (int n : List.of(0, pdf.getNumberOfPages() - 1)) ImageIO.write(new PDFRenderer(pdf).renderImageWithDPI(n, 90),
                    "png", Path.of("target/comprobante-largo-" + n + ".png").toFile());
        }
    }

    private Compra crear(boolean pagado, int cantidad) {
        var ordenes = new ArrayList<Orden>();
        for (int n = 0; n < cantidad; n++) ordenes.add(new Orden("CC-" + UUID.randomUUID(), UUID.randomUUID(), "Central histórica",
                EstadoOrden.PENDIENTE_PAGO, List.of(new OrdenItem(UUID.randomUUID(), UUID.randomUUID(), "Café histórico", 2, new BigDecimal("1800")))));
        var compra = compras.saveAndFlush(new Compra(cliente, Instant.parse("2026-10-01T12:00:00Z"), ordenes));
        if (pagado) pagar(compra);
        return compra;
    }
    private void pagar(Compra compra) {
        var pago = new Pago(compra, "SIMULADO", null); pago.aplicarResultado(EstadoPago.APROBADO, null); pagos.saveAndFlush(pago);
        jdbc.update("UPDATE compras SET estado='PAGADO' WHERE id=?", compra.getId());
        jdbc.update("UPDATE ordenes SET estado='PAGADO' WHERE compra_id=?", compra.getId());
    }
    private String ruta(UUID orden) { return "/orders/" + orden + "/boleta"; }
    private static String bearer(String usuario, String rol) {
        return "Bearer " + sign(claims().subject(usuario).claim("role", rol).build(), KEYS, com.nimbusds.jose.JWSAlgorithm.RS256);
    }
    private byte[] descargar(UUID id) throws Exception {
        return mvc.perform(get(ruta(id)).header("Authorization", bearer(cliente.toString(), "CLIENTE")))
                .andExpect(status().isOk()).andExpect(content().contentType("application/pdf"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"" + ComprobanteService.nombre(id) + "\""))
                .andReturn().getResponse().getContentAsByteArray();
    }
}
