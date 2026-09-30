package cl.cloudcoffee.api_gateway;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("cloudcoffee.rate-limit")
public record AuthRateLimitProperties(
        EndpointLimit login, EndpointLimit passwordRecovery, EndpointLimit verificationResend) {

    public record EndpointLimit(long capacity, Duration refillPeriod) {
        public EndpointLimit {
            if (capacity <= 0 || refillPeriod == null || refillPeriod.isNegative()
                    || refillPeriod.isZero() || refillPeriod.toNanos() <= 0) {
                throw new IllegalArgumentException("El limite y el periodo de rate limiting deben ser positivos");
            }
        }
    }
}
