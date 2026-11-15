package cl.cloudcoffee.order_service.revision;

import static org.assertj.core.api.Assertions.*;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

/** Actualización real V5→V6 en un schema propio, tanto en H2 como PostgreSQL. */
class RevisionMigrationTests {
    Connection connection;
    SingleConnectionDataSource data;
    Flyway flyway;
    String schema;
    UUID compra, cliente;

    @BeforeEach void prepararV5() throws Exception {
        schema = "int273_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:h2:mem:" + schema + ";MODE=PostgreSQL");
        connection = DriverManager.getConnection(url, System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "sa"),
                System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", ""));
        data = new SingleConnectionDataSource(connection, true);
        flyway = configuracion("5"); flyway.migrate(); connection.setSchema(schema);
        compra = UUID.randomUUID(); cliente = UUID.randomUUID();
        sql("INSERT INTO compras (id,usuario_id,monto_total,created_at) VALUES ('" + compra + "','" + cliente + "',2700,CURRENT_TIMESTAMP)");
    }
    @AfterEach void limpiarSoloSchemaEfimero() throws Exception {
        try { if (flyway != null) flyway.clean(); }
        finally { if (connection != null) connection.close(); }
    }
    @Test void conservaComprasYDiarioDeCreacionAlMigrar() throws Exception {
        sql("INSERT INTO creacion_compras (id,usuario_id,clave,hash_cuerpo,solicitud,trace_id,created_at,updated_at) VALUES ('"
                + UUID.randomUUID() + "','" + cliente + "','" + UUID.randomUUID()
                + "','hash','[]','12345678901234567890123456789012',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        flyway = configuracion("6"); flyway.migrate(); flyway.validate();
        try (var statement = connection.createStatement(); var result = statement.executeQuery(
                "SELECT monto_total,estado,revision_pendiente FROM compras WHERE id='" + compra + "'")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getBigDecimal(1)).isEqualByComparingTo("2700");
            assertThat(result.getString(2)).isEqualTo("PENDIENTE_PAGO");
            assertThat(result.getObject(3)).isNull();
        }
        try (var statement = connection.createStatement(); var result = statement.executeQuery("SELECT count(*) FROM creacion_compras")) {
            result.next(); assertThat(result.getInt(1)).isEqualTo(1);
        }
    }
    @Test void laBaseExigeIntencionUnicaReferenciasValidasYResultadoTerminado() throws Exception {
        flyway = configuracion("6"); flyway.migrate();
        UUID comando = UUID.randomUUID(), clave = UUID.randomUUID();
        insertar(comando, clave);
        sql("UPDATE compras SET revision_pendiente='" + comando + "' WHERE id='" + compra + "'");
        assertThatThrownBy(() -> insertar(UUID.randomUUID(), clave)).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> sql("UPDATE compras SET revision_pendiente='" + UUID.randomUUID()
                + "' WHERE id='" + compra + "'")).isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> sql("UPDATE revisiones_compra SET fase='TERMINADA' WHERE id='" + comando + "'"))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> sql("DELETE FROM compras WHERE id='" + compra + "'")).isInstanceOf(SQLException.class);
    }
    private Flyway configuracion(String target) {
        return Flyway.configure().dataSource(data).schemas(schema).defaultSchema(schema)
                .locations("classpath:db/migration").target(target).cleanDisabled(false).load();
    }
    private void insertar(UUID id, UUID clave) throws SQLException {
        sql("INSERT INTO revisiones_compra (id,compra_id,usuario_id,accion,ruta,clave,plan,trace_id,created_at,updated_at) VALUES ('"
                + id + "','" + compra + "','" + cliente + "','CONFIRMAR','/compras/" + compra + "/confirmar','" + clave
                + "','{}','12345678901234567890123456789012',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
    }
    private void sql(String sql) throws SQLException { try (var statement = connection.createStatement()) { statement.execute(sql); } }
}
