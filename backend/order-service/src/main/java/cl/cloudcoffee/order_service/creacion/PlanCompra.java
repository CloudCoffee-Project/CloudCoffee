package cl.cloudcoffee.order_service.creacion;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Diario privado: identidades y cotización quedan fijadas antes de tocar stock. */
public class PlanCompra {
    public UUID compraId = UUID.randomUUID();
    public Instant creadoAt;
    public Instant venceAt;
    public String fallo;
    public List<Grupo> grupos = new ArrayList<>();
    public static class Grupo {
        public UUID ordenId = UUID.randomUUID();
        public UUID cafeteriaId;
        public String cafeteriaNombre;
        public String fase = "RESERVANDO";
        public List<Linea> items = new ArrayList<>();
    }
    public static class Linea {
        public UUID itemId = UUID.randomUUID();
        public CatalogoCompras.Oferta oferta;
        public int cantidad;
        public UUID reservaId;
        public boolean solicitada;
        public boolean liberada;
    }
}
