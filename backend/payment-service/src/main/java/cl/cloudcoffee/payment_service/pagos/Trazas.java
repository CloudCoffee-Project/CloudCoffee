package cl.cloudcoffee.payment_service.pagos;

import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.MDC;

/** traceId de 32 hex del contrato: el de la traza en curso si existe, o uno nuevo. */
final class Trazas {

    private static final Pattern TRACE = Pattern.compile("[0-9a-f]{32}");

    private Trazas() {
    }

    static String actual() {
        String trace = MDC.get("traceId");
        if (trace != null) {
            trace = trace.toLowerCase(java.util.Locale.ROOT);
            // Trazas de 64 bits (16 hex) se completan a 128 bits como en W3C trace-context.
            if (trace.matches("[0-9a-f]{16}")) trace = "0000000000000000" + trace;
            if (TRACE.matcher(trace).matches()) return trace;
        }
        return UUID.randomUUID().toString().replace("-", "");
    }
}
