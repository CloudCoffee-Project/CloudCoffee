package cl.cloudcoffee.errors;

import java.net.URI;
import java.util.Objects;

import org.springframework.http.HttpStatus;

/** Error esperado: sus textos son públicos y deben poder mostrarse al cliente. */
public final class BusinessException extends RuntimeException {

    private final HttpStatus status;
    private final URI type;
    private final String title;

    public BusinessException(HttpStatus status, URI type, String title, String detail) {
        super(Objects.requireNonNull(detail));
        if (!status.is4xxClientError()) {
            throw new IllegalArgumentException("Un error de negocio debe utilizar un estado HTTP 4xx");
        }
        this.status = status;
        this.type = Objects.requireNonNull(type);
        this.title = Objects.requireNonNull(title);
    }

    public HttpStatus getStatus() {
        return status;
    }

    public URI getType() {
        return type;
    }

    public String getTitle() {
        return title;
    }
}
