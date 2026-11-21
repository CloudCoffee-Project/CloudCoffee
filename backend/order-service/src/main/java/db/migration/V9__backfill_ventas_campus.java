package db.migration;

import java.util.UUID;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Recupera el campus de la cotización original de las compras creadas antes de INT2-125. */
public class V9__backfill_ventas_campus extends BaseJavaMigration {
    @Override
    public Integer getChecksum() {
        return 1;
    }

    @Override
    public void migrate(Context context) throws Exception {
        var json = JsonMapper.builder().build();
        var connection = context.getConnection();
        try (var read = connection.prepareStatement("""
                    SELECT plan FROM creacion_compras WHERE fase='TERMINADA' AND status=201 AND plan IS NOT NULL
                    """);
                var write = connection.prepareStatement("""
                    UPDATE ordenes SET campus_id=? WHERE id=? AND compra_id=? AND cafeteria_id=? AND campus_id IS NULL
                    """)) {
            read.setFetchSize(100);
            try (var rows = read.executeQuery()) {
                while (rows.next()) {
                    JsonNode plan = json.readTree(rows.getString("plan"));
                    for (JsonNode grupo : plan.path("grupos")) {
                        JsonNode oferta = grupo.path("items").path(0).path("oferta");
                        if (oferta.path("campusId").isString()) {
                            write.setObject(1, uuid(oferta, "campusId"));
                            write.setObject(2, uuid(grupo, "ordenId"));
                            write.setObject(3, uuid(plan, "compraId"));
                            write.setObject(4, uuid(grupo, "cafeteriaId"));
                            write.addBatch();
                        }
                    }
                    write.executeBatch();
                }
            }
        }
    }

    private static UUID uuid(JsonNode node, String field) {
        return UUID.fromString(node.path(field).asString());
    }
}
