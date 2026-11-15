package cl.cloudcoffee.payment_service.mercadopago;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Puerto hacia Checkout Pro. La implementación real es {@link MercadoPagoPreferencias}; las pruebas usan un
 * adaptador controlado. Ninguna operación lanza excepciones por fallas del proveedor: el resultado distingue
 * explícitamente lo que se sabe (creada / no creada) de lo que no se sabe (incierta).
 */
public interface ProveedorPreferencias {

    /** Un único POST al proveedor. No reintenta: un reintento ciego podría duplicar la preferencia. */
    Creacion crear(NuevaPreferencia preferencia);

    /** Busca por referencia externa estable; solo lee, nunca crea. */
    Busqueda buscar(String referenciaExterna);

    record Item(UUID ofertaId, UUID ordenId, String titulo, int cantidad, long precioUnitario) {
    }

    record NuevaPreferencia(UUID paymentId, UUID compraId, String referenciaExterna, List<Item> items,
            Instant expiraAt, URI exito, URI pendiente, URI fallo) {
    }

    /** Preferencia confirmada por el proveedor, con la URL de checkout del modo configurado. */
    record Preferencia(String id, String referenciaExterna, URI checkout) {
    }

    sealed interface Creacion permits Creada, NoCreada, Incierta {
    }

    record Creada(Preferencia preferencia) implements Creacion {
    }

    /** El proveedor no creó nada (rechazo 4xx definitivo o la conexión nunca se estableció). */
    record NoCreada(String motivo) implements Creacion {
    }

    /** Timeout, 5xx, respuesta perdida o inválida: la preferencia podría existir. */
    record Incierta(String motivo) implements Creacion {
    }

    sealed interface Busqueda permits Encontradas, BusquedaFallida {
    }

    record Encontradas(List<Preferencia> preferencias) implements Busqueda {
    }

    record BusquedaFallida(String motivo) implements Busqueda {
    }
}
