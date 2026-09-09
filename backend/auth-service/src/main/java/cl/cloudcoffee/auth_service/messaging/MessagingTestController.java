package cl.cloudcoffee.auth_service.messaging;

import java.util.UUID;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@ConditionalOnProperty(
        name = "cloudcoffee.messaging.test-endpoint-enabled",
        havingValue = "true"
)
@RestController
@RequestMapping("/internal/test/events")
public class MessagingTestController {

    private final AuthEventPublisher publisher;

    public MessagingTestController(AuthEventPublisher publisher) {
        this.publisher = publisher;
    }

    @PostMapping("/user-registered")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public CloudCoffeeEvent publishUserRegistered(
            @RequestParam String userId,
            @RequestParam String email,
            @RequestHeader(
                    value = "X-Trace-Id",
                    required = false
            ) String traceId
    ) {
        String effectiveTraceId =
                traceId == null || traceId.isBlank()
                        ? UUID.randomUUID().toString()
                        : traceId;

        return publisher.publishUserRegistered(
                userId,
                email,
                effectiveTraceId
        );
    }
}
