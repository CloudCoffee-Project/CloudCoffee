package cl.cloudcoffee.order_service.messaging;

import java.util.UUID;

import io.micrometer.tracing.Span;
import io.micrometer.tracing.Tracer;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/** traceId de la traza activa (Micrometer/Zipkin); si no hay una, genera uno nuevo. */
@Component
public class TraceIdProvider {

    private final ObjectProvider<Tracer> tracer;

    public TraceIdProvider(ObjectProvider<Tracer> tracer) {
        this.tracer = tracer;
    }

    public String actual() {
        Tracer activo = tracer.getIfAvailable();
        Span span = activo == null ? null : activo.currentSpan();
        if (span != null && span.context().traceId() != null && !span.context().traceId().isBlank()) {
            return span.context().traceId();
        }
        return UUID.randomUUID().toString();
    }
}
