package cl.cloudcoffee.order_service;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.*;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

class RetencionMigrationTests {
    @Test
    void migraV9SinMarcarPendientesYConservaFechasTerminalesAlReiniciar() throws Exception {
        String schema = "retencion_" + UUID.randomUUID().toString().replace("-", "");
        String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:h2:mem:" + schema + ";MODE=PostgreSQL");
        try (Connection connection = DriverManager.getConnection(url, System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "sa"),
                System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", ""))) {
            var ds = new SingleConnectionDataSource(connection, true);
            var previo = Flyway.configure().dataSource(ds).schemas(schema).defaultSchema(schema).target("9")
                    .locations("classpath:db/migration").cleanDisabled(false).load();
            try {
                previo.migrate(); connection.setSchema(schema); var jdbc = new JdbcTemplate(ds);
                UUID finalizada = UUID.randomUUID(), pendiente = UUID.randomUUID();
                for (UUID id : java.util.List.of(finalizada, pendiente)) jdbc.update("""
                    INSERT INTO creacion_compras(id,usuario_id,clave,hash_cuerpo,solicitud,fase,status,respuesta,trace_id,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,TIMESTAMP '2026-10-01 10:00:00',TIMESTAMP '2026-10-05 10:00:00')
                    """, id, UUID.randomUUID(), UUID.randomUUID(), "a".repeat(64), "[]", id.equals(finalizada) ? "TERMINADA" : "RESERVANDO",
                        id.equals(finalizada) ? 409 : null, id.equals(finalizada) ? "{}" : null, "a".repeat(32));
                var nueva = Flyway.configure().dataSource(ds).schemas(schema).defaultSchema(schema)
                        .locations("classpath:db/migration").cleanDisabled(false).load();
                nueva.migrate(); nueva.validate(); nueva.migrate();
                assertThat(jdbc.queryForObject("SELECT completed_at=updated_at FROM creacion_compras WHERE id=?", Boolean.class, finalizada)).isTrue();
                assertThat(jdbc.queryForObject("SELECT completed_at IS NULL FROM creacion_compras WHERE id=?", Boolean.class, pendiente)).isTrue();
                assertThat(jdbc.queryForObject("SELECT count(*) FROM creacion_compras", Long.class)).isEqualTo(2L);
            } finally { previo.clean(); }
        }
    }
}
