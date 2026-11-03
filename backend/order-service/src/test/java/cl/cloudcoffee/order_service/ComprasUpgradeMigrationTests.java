package cl.cloudcoffee.order_service;

import static org.assertj.core.api.Assertions.*;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

/** Se ejecuta en H2 local y PostgreSQL en CI, usando siempre un schema efímero. */
class ComprasUpgradeMigrationTests {
    private Flyway flyway;
    private Connection connection;
    private String schema;

    @BeforeEach
    void baseEnV3() throws SQLException {
        schema = "int252_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:h2:mem:" + schema);
        String user = System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "sa");
        String password = System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", "");
        // Mantener abierta la conexión para que H2 conserve la base entre migraciones.
        connection = DriverManager.getConnection(url, user, password);
        flyway = Flyway.configure().dataSource(new SingleConnectionDataSource(connection, true))
                .schemas(schema).defaultSchema(schema)
                .locations("classpath:db/migration").target("3").cleanDisabled(false).load();
        flyway.migrate();
        connection.setSchema(schema);
    }

    @AfterEach
    void borrarSoloElSchemaTemporal() throws SQLException {
        try {
            if (flyway != null) flyway.clean();
        } finally {
            if (connection != null) connection.close();
        }
    }

    @Test
    void migraV3ConComprasPagosEIdempotenciaSinPerderHistorial() throws SQLException {
        UUID pendiente = compra("3700.00");
        UUID aprobada = compra("900.00");
        UUID rechazada = compra("1500.00");
        pago(aprobada, "APROBADO", "900.00");
        pago(rechazada, "RECHAZADO", "1500.00");
        ejecutar("INSERT INTO idempotencia VALUES ('" + UUID.randomUUID() + "', '" + UUID.randomUUID()
                + "', 'POST', '/compras/x/pago', '" + UUID.randomUUID()
                + "', 'hash', 201, '{}', '/v1/compras/x/pago', CURRENT_TIMESTAMP)");

        migrarV4();

        assertThat(texto("SELECT estado FROM compras WHERE id='" + pendiente + "'")).isEqualTo("PENDIENTE_PAGO");
        assertThat(texto("SELECT estado FROM compras WHERE id='" + aprobada + "'")).isEqualTo("PAGADO");
        assertThat(texto("SELECT estado FROM compras WHERE id='" + rechazada + "'")).isEqualTo("CANCELADO");
        assertThat(texto("SELECT monto_total FROM compras WHERE id='" + rechazada + "'"))
                .isEqualTo("0.00");
        assertThat(texto("SELECT monto FROM pagos WHERE compra_id='" + rechazada + "'"))
                .isEqualTo("1500.00");
        assertThat(texto("SELECT COUNT(*) FROM idempotencia")).isEqualTo("1");
        assertThat(texto("SELECT COUNT(*) FROM ordenes")).isEqualTo("0");
        assertThat(texto("SELECT COUNT(*) FROM compras WHERE reserva_expira_at = created_at + INTERVAL '15' MINUTE"
                + " AND updated_at = created_at AND version = 0 AND moneda = 'CLP'")).isEqualTo("3");
        flyway.validate();
    }

    @Test
    void noRedondeaFraccionesHistoricasParaHacerlasPasarPorPesosEnteros() throws SQLException {
        compra("1500.50");
        assertThatThrownBy(this::migrarV4).hasMessageContaining("chk_compras_monto_total");
    }

    @Test
    void restriccionesProtegenImportesEstadosSnapshotsYRelaciones() throws SQLException {
        migrarV4();
        UUID compra = compra("2000000000");
        pago(compra, "PENDIENTE", "2000000000");
        assertSqlInvalido("UPDATE compras SET monto_total=1.50 WHERE id='" + compra + "'");
        assertSqlInvalido("UPDATE pagos SET monto=1.50 WHERE compra_id='" + compra + "'");
        assertSqlInvalido("UPDATE compras SET monto_total=2000000001 WHERE id='" + compra + "'");
        assertSqlInvalido("UPDATE compras SET estado='RESERVANDO' WHERE id='" + compra + "'");
        UUID orden = UUID.randomUUID();
        UUID cafeteria = UUID.randomUUID();
        insertarOrden(orden, compra, cafeteria, "CC-1");
        assertThatThrownBy(() -> insertarOrden(UUID.randomUUID(), compra, cafeteria, "CC-2"))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertarOrden(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "CC-3"))
                .isInstanceOf(SQLException.class);
        UUID oferta = UUID.randomUUID();
        insertarItem(orden, oferta, 2, "1800", "3600");
        assertThatThrownBy(() -> insertarItem(orden, oferta, 2, "1800", "3600"))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertarItem(orden, UUID.randomUUID(), 101, "1", "101"))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> insertarItem(orden, UUID.randomUUID(), 2, "1800", "3500"))
                .isInstanceOf(SQLException.class);
        assertSqlInvalido("DELETE FROM ordenes WHERE id='" + orden + "'");
        assertSqlInvalido("DELETE FROM compras WHERE id='" + compra + "'");
        ejecutar("UPDATE compras SET estado='CANCELADO', monto_total=0 WHERE id='" + compra + "'");
    }

    @Test
    void reejecutarSeedNoReescribeUnaCompraCancelada() throws SQLException {
        migrarV4();
        var seed = new ResourceDatabasePopulator(new ClassPathResource("db/seed/dev/R__seed_compras_desarrollo.sql"));
        seed.populate(connection);
        String id = "77777777-7777-4777-8777-777777777701";
        ejecutar("UPDATE compras SET estado='CANCELADO', monto_total=0 WHERE id='" + id + "'");
        seed.populate(connection);
        assertThat(texto("SELECT monto_total FROM compras WHERE id='" + id + "'")).isEqualTo("0.00");
        assertThat(texto("SELECT estado FROM compras WHERE id='" + id + "'")).isEqualTo("CANCELADO");
        assertThat(texto("SELECT COUNT(*) FROM compras")).isEqualTo("3");
    }

    private void migrarV4() {
        flyway = Flyway.configure().configuration(flyway.getConfiguration()).target(MigrationVersion.LATEST).load();
        flyway.migrate();
    }

    private UUID compra(String monto) throws SQLException {
        UUID id = UUID.randomUUID();
        ejecutar("INSERT INTO compras (id, usuario_id, monto_total, created_at) VALUES ('" + id + "', '"
                + UUID.randomUUID() + "', " + monto + ", TIMESTAMP '2026-10-01 12:00:00')");
        return id;
    }

    private void pago(UUID compra, String estado, String monto) throws SQLException {
        ejecutar("INSERT INTO pagos (id, compra_id, estado, monto, proveedor, version, created_at) VALUES ('"
                + UUID.randomUUID() + "', '" + compra + "', '" + estado + "', " + monto
                + ", 'SIMULADO', 0, CURRENT_TIMESTAMP)");
    }

    private void insertarOrden(UUID orden, UUID compra, UUID cafeteria, String codigo) throws SQLException {
        ejecutar("INSERT INTO ordenes (id, compra_id, codigo_orden, cafeteria_id, cafeteria_nombre, estado,"
                + " monto_total, reserva_expira_at, created_at, updated_at) VALUES ('" + orden + "', '" + compra
                + "', '" + codigo + "', '" + cafeteria + "', 'Central', 'PENDIENTE_PAGO', 3600,"
                + " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
    }

    private void insertarItem(UUID orden, UUID oferta, int cantidad, String precio, String subtotal) throws SQLException {
        ejecutar("INSERT INTO orden_items VALUES ('" + UUID.randomUUID() + "', '" + orden + "', '" + oferta
                + "', '" + UUID.randomUUID() + "', 'Café original', " + cantidad + ", " + precio + ", " + subtotal + ")");
    }

    private void assertSqlInvalido(String sql) {
        assertThatThrownBy(() -> ejecutar(sql)).isInstanceOf(SQLException.class);
    }

    private void ejecutar(String sql) throws SQLException {
        try (Statement statement = connection.createStatement()) { statement.execute(sql); }
    }

    private String texto(String sql) throws SQLException {
        try (Statement statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            rows.next();
            return rows.getString(1);
        }
    }
}
