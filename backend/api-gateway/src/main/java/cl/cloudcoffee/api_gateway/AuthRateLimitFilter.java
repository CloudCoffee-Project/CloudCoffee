package cl.cloudcoffee.api_gateway;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import cl.cloudcoffee.errors.ApiProblems;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.TimeMeter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.json.JsonMapper;

final class AuthRateLimitFilter extends OncePerRequestFilter {

    private final Map<String, EndpointBuckets> endpoints;
    private final JsonMapper mapper;

    AuthRateLimitFilter(AuthRateLimitProperties properties, JsonMapper mapper) {
        this(properties, mapper, TimeMeter.SYSTEM_NANOTIME);
    }

    AuthRateLimitFilter(AuthRateLimitProperties properties, JsonMapper mapper, TimeMeter timeMeter) {
        this.mapper = mapper;
        endpoints = Map.of(
                "/v1/auth/login", new EndpointBuckets(properties.login(), timeMeter),
                "/v1/auth/password/recovery", new EndpointBuckets(properties.passwordRecovery(), timeMeter),
                "/v1/auth/verificacion/reenviar", new EndpointBuckets(properties.verificationResend(), timeMeter));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String path = request.getServletPath();
        if (path.isEmpty()) {
            path = request.getRequestURI().substring(request.getContextPath().length());
        }
        EndpointBuckets endpoint = endpoints.get(path);
        if (!"POST".equals(request.getMethod()) || endpoint == null) {
            chain.doFilter(request, response);
            return;
        }

        // No interpretar X-Forwarded-For ni Forwarded enviados por el cliente.
        ConsumptionProbe probe = endpoint.consume(request.getRemoteAddr());
        if (probe.isConsumed()) {
            chain.doFilter(request, response);
            return;
        }

        long nanosToWait = probe.getNanosToWaitForRefill();
        long secondsToWait = TimeUnit.NANOSECONDS.toSeconds(nanosToWait);
        if (nanosToWait % TimeUnit.SECONDS.toNanos(1) != 0) {
            secondsToWait++;
        }
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(Math.max(1, secondsToWait)));
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        mapper.writeValue(response.getOutputStream(), ApiProblems.create(HttpStatus.TOO_MANY_REQUESTS,
                "Demasiadas solicitudes. Inténtalo nuevamente después del tiempo indicado en Retry-After.", request));
    }

    private static final class EndpointBuckets {
        private final Bandwidth bandwidth;
        private final TimeMeter timeMeter;
        private final Cache<String, Bucket> buckets;

        EndpointBuckets(AuthRateLimitProperties.EndpointLimit limit, TimeMeter timeMeter) {
            bandwidth = Bandwidth.builder().capacity(limit.capacity())
                    .refillIntervally(limit.capacity(), limit.refillPeriod()).build();
            this.timeMeter = timeMeter;
            // Tras un periodo sin uso, el bucket ya estaria lleno y puede eliminarse.
            buckets = Caffeine.newBuilder().expireAfterAccess(limit.refillPeriod())
                    .ticker(timeMeter::currentTimeNanos).build();
        }

        ConsumptionProbe consume(String address) {
            return buckets.get(address, ignored -> Bucket.builder()
                    .withCustomTimePrecision(timeMeter)
                    .addLimit(bandwidth)
                    .build()).tryConsumeAndReturnRemaining(1);
        }
    }
}
