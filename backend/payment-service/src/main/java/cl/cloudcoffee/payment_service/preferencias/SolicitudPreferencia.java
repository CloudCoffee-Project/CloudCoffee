package cl.cloudcoffee.payment_service.preferencias;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;

import cl.cloudcoffee.errors.BusinessException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Comando interno de Order (contrato CrearPreferencia). Se valida a mano sobre el árbol JSON: así un
 * importe 4800.9 o "4800" se rechaza en vez de truncarse o convertirse, y no se aceptan campos extra
 * (por ejemplo una URL de retorno o un estado enviados por el navegador a través de Order).
 */
public record SolicitudPreferencia(UUID compraId, UUID clienteId, long montoTotal, String moneda,
        List<Item> items, String canalRetorno, Instant expiraAt) {

    public static final long MONTO_MAXIMO = 2_000_000_000L;
    private static final Set<String> CAMPOS = Set.of("compraId", "clienteId", "montoTotal", "moneda", "items",
            "canalRetorno", "expiraAt");
    private static final Set<String> CAMPOS_ITEM = Set.of("ordenId", "ofertaId", "titulo", "cantidad", "precioUnitario");
    static final URI TIPO = URI.create("https://cloudcoffee.cl/problemas/solicitud-invalida");

    public record Item(UUID ordenId, UUID ofertaId, String titulo, int cantidad, long precioUnitario) {
    }

    public static SolicitudPreferencia desde(JsonNode raiz) {
        if (raiz == null || !raiz.isObject()) throw invalida("El cuerpo debe ser un objeto JSON.");
        soloCampos(raiz, CAMPOS, "");
        UUID compra = uuid(raiz, "compraId");
        UUID cliente = uuid(raiz, "clienteId");
        long total = entero(raiz, "montoTotal", 1, MONTO_MAXIMO);
        String moneda = texto(raiz, "moneda", 3);
        if (!"CLP".equals(moneda)) throw invalida("moneda debe ser CLP.");
        String canal = texto(raiz, "canalRetorno", 16);
        if (!canal.equals("web") && !canal.equals("mobile")) throw invalida("canalRetorno debe ser web o mobile.");
        Instant expira = instante(raiz, "expiraAt");
        JsonNode lista = raiz.get("items");
        if (lista == null || !lista.isArray() || lista.isEmpty() || lista.size() > 100) {
            throw invalida("items debe tener entre 1 y 100 elementos.");
        }
        List<Item> items = new ArrayList<>();
        long suma = 0;
        for (int i = 0; i < lista.size(); i++) {
            JsonNode nodo = lista.get(i);
            String prefijo = "items[" + i + "].";
            if (!nodo.isObject()) throw invalida("items[" + i + "] debe ser un objeto.");
            soloCampos(nodo, CAMPOS_ITEM, prefijo);
            Item item = new Item(uuid(nodo, "ordenId", prefijo), uuid(nodo, "ofertaId", prefijo),
                    texto(nodo, "titulo", 255, prefijo), (int) entero(nodo, "cantidad", 1, 100, prefijo),
                    entero(nodo, "precioUnitario", 1, MONTO_MAXIMO, prefijo));
            items.add(item);
            suma = Math.addExact(suma, Math.multiplyExact(item.precioUnitario(), (long) item.cantidad()));
        }
        // El total lo congela Order; Payment solo acepta un total que coincide exactamente con sus ítems.
        if (suma != total) throw invalida("montoTotal no coincide con la suma de los ítems.");
        return new SolicitudPreferencia(compra, cliente, total, moneda, List.copyOf(items), canal, expira);
    }

    /** JSON canónico (orden fijo, instante normalizado): base del hash de idempotencia y del payload guardado. */
    public String canonico(JsonMapper json) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("compraId", compraId.toString());
        m.put("clienteId", clienteId.toString());
        m.put("montoTotal", montoTotal);
        m.put("moneda", moneda);
        m.put("items", items.stream().map(item -> {
            Map<String, Object> i = new LinkedHashMap<>();
            i.put("ordenId", item.ordenId().toString());
            i.put("ofertaId", item.ofertaId().toString());
            i.put("titulo", item.titulo());
            i.put("cantidad", item.cantidad());
            i.put("precioUnitario", item.precioUnitario());
            return i;
        }).toList());
        m.put("canalRetorno", canalRetorno);
        m.put("expiraAt", expiraAt.toString());
        return json.writeValueAsString(m);
    }

    public static String sha256(String valor) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(valor.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException imposible) {
            throw new IllegalStateException(imposible);
        }
    }

    public static UUID clave(String valor) {
        if (valor == null || valor.isBlank()) throw invalida("Idempotency-Key es obligatorio.");
        try {
            UUID uuid = UUID.fromString(valor.trim());
            if (!uuid.toString().equalsIgnoreCase(valor.trim())) throw new IllegalArgumentException();
            return uuid;
        } catch (IllegalArgumentException error) {
            throw invalida("Idempotency-Key debe ser un UUID.");
        }
    }

    static BusinessException invalida(String detalle) {
        return new BusinessException(HttpStatus.BAD_REQUEST, TIPO, "Solicitud inválida", detalle, "SOLICITUD_INVALIDA");
    }

    private static void soloCampos(JsonNode nodo, Set<String> permitidos, String prefijo) {
        for (var campo : nodo.properties()) {
            if (!permitidos.contains(campo.getKey())) throw invalida(prefijo + campo.getKey() + " no está permitido.");
        }
    }

    private static UUID uuid(JsonNode nodo, String campo) {
        return uuid(nodo, campo, "");
    }

    private static UUID uuid(JsonNode nodo, String campo, String prefijo) {
        String valor = texto(nodo, campo, 36, prefijo);
        try {
            UUID uuid = UUID.fromString(valor);
            if (!uuid.toString().equalsIgnoreCase(valor)) throw new IllegalArgumentException();
            return uuid;
        } catch (IllegalArgumentException error) {
            throw invalida(prefijo + campo + " debe ser un UUID.");
        }
    }

    private static String texto(JsonNode nodo, String campo, int maximo) {
        return texto(nodo, campo, maximo, "");
    }

    private static String texto(JsonNode nodo, String campo, int maximo, String prefijo) {
        JsonNode valor = nodo.get(campo);
        if (valor == null || !valor.isString() || valor.asString().isBlank() || valor.asString().length() > maximo) {
            throw invalida(prefijo + campo + " es obligatorio y debe ser un texto de hasta " + maximo + " caracteres.");
        }
        return valor.asString();
    }

    private static long entero(JsonNode nodo, String campo, long minimo, long maximo) {
        return entero(nodo, campo, minimo, maximo, "");
    }

    private static long entero(JsonNode nodo, String campo, long minimo, long maximo, String prefijo) {
        JsonNode valor = nodo.get(campo);
        if (valor == null || !valor.isIntegralNumber() || !valor.canConvertToLong()
                || valor.longValue() < minimo || valor.longValue() > maximo) {
            throw invalida(prefijo + campo + " debe ser un entero entre " + minimo + " y " + maximo + ".");
        }
        return valor.longValue();
    }

    private static Instant instante(JsonNode nodo, String campo) {
        String valor = texto(nodo, campo, 64);
        try {
            return Instant.parse(valor);
        } catch (DateTimeParseException error) {
            try {
                return java.time.OffsetDateTime.parse(valor).toInstant();
            } catch (DateTimeParseException otra) {
                throw invalida(campo + " debe ser una fecha ISO-8601 con zona horaria.");
            }
        }
    }
}
