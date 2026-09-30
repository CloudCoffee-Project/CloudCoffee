package cl.cloudcoffee.api_gateway;

import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicLong;

import io.github.bucket4j.TimeMeter;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class AuthRateLimitFilterTests {

    @Test
    void quotaRefillsAtTheConfiguredPeriodAndRetryAfterRoundsUp() throws Exception {
        AtomicLong now = new AtomicLong();
        AuthRateLimitFilter filter = filter(now);
        assertThat(perform(filter).getStatus()).isEqualTo(200);
        assertThat(perform(filter).getStatus()).isEqualTo(200);
        MockHttpServletResponse rejected = perform(filter);
        assertThat(rejected.getStatus()).isEqualTo(429);
        assertThat(rejected.getHeader(HttpHeaders.RETRY_AFTER)).isEqualTo("2");

        now.set(Duration.ofMillis(1499).toNanos());
        rejected = perform(filter);
        assertThat(rejected.getStatus()).isEqualTo(429);
        assertThat(rejected.getHeader(HttpHeaders.RETRY_AFTER)).isEqualTo("1");
        now.set(Duration.ofMillis(1500).toNanos());
        assertThat(perform(filter).getStatus()).isEqualTo(200);
        assertThat(perform(filter).getStatus()).isEqualTo(200);
        assertThat(perform(filter).getStatus()).isEqualTo(429);
    }

    @Test
    void concurrentRequestsCannotExceedTheQuota() throws Exception {
        AuthRateLimitFilter filter = filter(new AtomicLong());
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var results = new ArrayList<Future<Integer>>();
            for (int i = 0; i < 20; i++) {
                results.add(executor.submit(() -> perform(filter).getStatus()));
            }
            var statuses = new ArrayList<Integer>();
            for (Future<Integer> result : results) {
                statuses.add(result.get());
            }
            assertThat(statuses.stream().filter(status -> status == 200).count()).isEqualTo(2);
            assertThat(statuses.stream().filter(status -> status == 429).count()).isEqualTo(18);
        }
    }

    @Test
    void anIdleBucketCanBeRecreatedWithAFullQuota() throws Exception {
        AtomicLong now = new AtomicLong();
        AuthRateLimitFilter filter = filter(now);
        perform(filter);
        perform(filter);
        assertThat(perform(filter).getStatus()).isEqualTo(429);
        now.set(Duration.ofSeconds(2).toNanos());
        assertThat(perform(filter).getStatus()).isEqualTo(200);
        assertThat(perform(filter).getStatus()).isEqualTo(200);
        assertThat(perform(filter).getStatus()).isEqualTo(429);
    }

    private AuthRateLimitFilter filter(AtomicLong now) {
        TimeMeter clock = new TimeMeter() {
            @Override
            public long currentTimeNanos() {
                return now.get();
            }

            @Override
            public boolean isWallClockBased() {
                return false;
            }
        };
        var limit = new AuthRateLimitProperties.EndpointLimit(2, Duration.ofMillis(1500));
        return new AuthRateLimitFilter(new AuthRateLimitProperties(limit, limit, limit),
                JsonMapper.builder().build(), clock);
    }

    private MockHttpServletResponse perform(AuthRateLimitFilter filter) throws Exception {
        var request = new MockHttpServletRequest("POST", "/v1/auth/login");
        request.setRemoteAddr("192.0.2.1");
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> {});
        return response;
    }
}
