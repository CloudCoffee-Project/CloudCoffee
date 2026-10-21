package cl.cloudcoffee.errors;

import java.net.URI;
import java.util.Objects;

import org.springframework.http.HttpStatus;

/** Error esperado: sus textos son públicos y deben poder mostrarse al cliente. */
public final class BusinessException extends RuntimeException {

    private final HttpStatus status;
    private final URI type;
    private final String title;
    private final String code;

    public BusinessException(HttpStatus status, URI type, String title, String detail) {
        this(status, type, title, detail, null);
    }

    /**
     * @param code código de dominio estable (por ejemplo {@code PAGO_YA_INICIADO}); se
     *             publica como extensión {@code code} del Problem Details.
     */
    public BusinessException(HttpStatus status, URI type, String title, String detail, String code) {
        super(Objects.requireNonNull(detail));
        if (!status.is4xxClientError()) {
            throw new IllegalArgumentException("Un error de negocio debe utilizar un estado HTTP 4xx");
        }
        this.status = status;
        this.type = Objects.requireNonNull(type);
        this.title = Objects.requireNonNull(title);
        this.code = code;
    }

    /** Código de dominio, o null si el error no define uno. */
    public String getCode() {
        return code;
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
