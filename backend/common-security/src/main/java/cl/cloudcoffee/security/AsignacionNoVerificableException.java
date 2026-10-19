package cl.cloudcoffee.security;

/** No se pudo consultar la asignación en auth-service; quien autoriza debe negar el acceso. */
public class AsignacionNoVerificableException extends RuntimeException {

    public AsignacionNoVerificableException(String message, Throwable cause) {
        super(message, cause);
    }
}
