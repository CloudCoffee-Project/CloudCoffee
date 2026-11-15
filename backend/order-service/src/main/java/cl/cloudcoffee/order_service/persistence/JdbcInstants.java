package cl.cloudcoffee.order_service.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/** Las columnas TIMESTAMP sin zona usan UTC, igual que los Instant de Hibernate. */
public final class JdbcInstants {
    private JdbcInstants() {}
    public static LocalDateTime utc(Instant instant) { return LocalDateTime.ofInstant(instant, ZoneOffset.UTC); }
    public static Instant read(ResultSet rs, String column) throws SQLException {
        return rs.getObject(column, LocalDateTime.class).toInstant(ZoneOffset.UTC);
    }
}
