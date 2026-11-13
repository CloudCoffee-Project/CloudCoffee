package cl.cloudcoffee.payment_service.mercadopago;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import cl.cloudcoffee.payment_service.config.PaymentProperties;
import cl.cloudcoffee.payment_service.mercadopago.ProveedorPreferencias.*;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Evidencia manual contra Mercado Pago sandbox (no corre en CI). Crea una preferencia real de 4.800 CLP,
 * verifica que la búsqueda por external_reference la encuentra (base de la conciliación) y guarda el
 * resultado sin credenciales en target/mercadopago-sandbox-evidence.json. Ver payment-service/README.md.
 */
@EnabledIfEnvironmentVariable(named = "MERCADOPAGO_EVIDENCE", matches = "true")
class MercadoPagoSandboxEvidenceTests {

    @Test
    void createsARealSandboxPreferenceAndFindsItByExternalReference() throws Exception {
        String retorno = System.getenv().getOrDefault("PAYMENT_WEB_RETURN_URL", "https://example.com/cloudcoffee/pagos/retorno");
        var properties = new PaymentProperties("mercadopago_sandbox", Duration.ofSeconds(10), Duration.ofMinutes(5),
                System.getenv("MERCADOPAGO_ACCESS_TOKEN"), "", null, URI.create(retorno), URI.create(retorno),
                System.getenv("PAYMENT_CHECKOUT_MODE"), null, null);
        var adapter = new MercadoPagoPreferencias(properties);
        UUID payment = UUID.randomUUID();
        UUID compra = UUID.randomUUID();
        Instant expira = Instant.now().plus(15, ChronoUnit.MINUTES);

        var creacion = adapter.crear(new NuevaPreferencia(payment, compra, payment.toString(), List.of(
                new Item(UUID.randomUUID(), UUID.randomUUID(), "Café americano", 2, 1800),
                new Item(UUID.randomUUID(), UUID.randomUUID(), "Té", 1, 1200)), expira,
                URI.create(retorno + "?compraId=" + compra + "&resultado=exito"),
                URI.create(retorno + "?compraId=" + compra + "&resultado=pendiente"),
                URI.create(retorno + "?compraId=" + compra + "&resultado=fallo")));
        assertThat(creacion).as("resultado de la creación: %s", creacion).isInstanceOf(Creada.class);
        var preferencia = ((Creada) creacion).preferencia();

        // La búsqueda puede tardar en reflejar la preferencia: se mide para fijar PAYMENT_RECONCILIATION_SETTLE_TIME.
        Instant inicioBusqueda = Instant.now();
        Busqueda busqueda = null;
        for (int intento = 0; intento < 30; intento++) {
            busqueda = adapter.buscar(payment.toString());
            if (busqueda instanceof Encontradas e && !e.preferencias().isEmpty()) break;
            Thread.sleep(2000);
        }
        long segundosBusqueda = Duration.between(inicioBusqueda, Instant.now()).toSeconds();
        assertThat(busqueda).as("búsqueda: %s", busqueda).isInstanceOf(Encontradas.class);
        assertThat(((Encontradas) busqueda).preferencias()).extracting(Preferencia::id).containsExactly(preferencia.id());

        Map<String, Object> evidencia = new LinkedHashMap<>();
        evidencia.put("fecha", Instant.now().toString());
        evidencia.put("checkoutMode", properties.checkoutMode());
        evidencia.put("preferenciaId", preferencia.id());
        evidencia.put("referenciaExterna", preferencia.referenciaExterna());
        evidencia.put("checkout", preferencia.checkout().toString());
        evidencia.put("montoTotal", 4800);
        evidencia.put("expiraAt", expira.toString());
        evidencia.put("busquedaEncontradaTrasSegundos", segundosBusqueda);
        Path archivo = Path.of("target", "mercadopago-sandbox-evidence.json");
        Files.createDirectories(archivo.getParent());
        Files.writeString(archivo, JsonMapper.builder().build().writerWithDefaultPrettyPrinter().writeValueAsString(evidencia));
        System.out.println("Evidencia sandbox: " + archivo.toAbsolutePath() + System.lineSeparator() + Files.readString(archivo));
    }
}
