package cl.cloudcoffee.order_service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-53: la migración V2 impone estados, montos y vínculo con la compra en la base. */
@SpringBootTest(properties = "management.tracing.enabled=false")
class PagosMigrationTests extends JwtTestSupport {

    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;

    @Test
    void migracionDeComprasYPagosEstaAplicada() {
        assertThat(flyway.info().applied())
                .anySatisfy(migration -> assertThat(migration.getScript()).isEqualTo("V2__create_compras_y_pagos.sql"));
    }

    @Test
    void aceptaUnPagoValidoVinculadoAUnaCompra() {
        UUID compra = insertarCompra("1500.00");

        insertarPago(compra, "PENDIENTE", "1500.00");

        assertThat(jdbc.queryForObject("SELECT estado FROM pagos WHERE compra_id = ?", String.class, compra))
                .isEqualTo("PENDIENTE");
    }

    @Test
    void rechazaEstadosFueraDelCatalogo() {
        UUID compra = insertarCompra("1500.00");

        assertThatThrownBy(() -> insertarPago(compra, "REEMBOLSADO", "1500.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void rechazaMontosNoPositivos() {
        UUID compra = insertarCompra("1500.00");

        assertThatThrownBy(() -> insertarPago(compra, "PENDIENTE", "0.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertarCompra("-10.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void rechazaPagosSinCompraExistente() {
        assertThatThrownBy(() -> insertarPago(UUID.randomUUID(), "PENDIENTE", "1500.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void rechazaReferenciasDuplicadasDelMismoProveedor() {
        String referencia = "SIM-" + UUID.randomUUID();
        insertarPago(insertarCompra("1500.00"), "RECHAZADO", "1500.00", referencia);

        // Otra compra, para que solo choque la referencia y no la regla de un pago por compra.
        UUID otraCompra = insertarCompra("1500.00");
        assertThatThrownBy(() -> insertarPago(otraCompra, "PENDIENTE", "1500.00", referencia))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void unaCompraNoAdmiteUnSegundoPagoNiSiquieraTrasUnRechazo() {
        // Contrato INT2-50 (#112): la base respalda la regla aunque se salte el servicio.
        UUID compra = insertarCompra("1500.00");
        insertarPago(compra, "RECHAZADO", "1500.00");

        assertThatThrownBy(() -> insertarPago(compra, "PENDIENTE", "1500.00"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM pagos WHERE compra_id = ?", Integer.class, compra))
                .isEqualTo(1);
    }

    private UUID insertarCompra(String monto) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO compras (id, usuario_id, monto_total, created_at) VALUES (?, ?, ?, ?)",
                id, UUID.randomUUID(), new java.math.BigDecimal(monto), Timestamp.from(Instant.now()));
        return id;
    }

    private void insertarPago(UUID compra, String estado, String monto) {
        insertarPago(compra, estado, monto, null);
    }

    private void insertarPago(UUID compra, String estado, String monto, String referencia) {
        jdbc.update("""
                INSERT INTO pagos (id, compra_id, estado, monto, proveedor, referencia_proveedor, version, created_at)
                VALUES (?, ?, ?, ?, 'SIMULADO', ?, 0, ?)
                """, UUID.randomUUID(), compra, estado, new java.math.BigDecimal(monto), referencia,
                Timestamp.from(Instant.now()));
    }
}
