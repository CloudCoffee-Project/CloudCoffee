package cl.cloudcoffee.order_service.revision;

import cl.cloudcoffee.order_service.creacion.CatalogoCompras;
import cl.cloudcoffee.order_service.dto.CompraResponse;
import cl.cloudcoffee.order_service.dto.OrdenItemResponse;
import cl.cloudcoffee.order_service.dto.OrdenResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Snapshot privado e intenciones remotas estables de una confirmación/cancelación. */
public class PlanRevision {
    public CompraResponse compra;
    public String paso;
    public String fallo;
    public List<Grupo> grupos = new ArrayList<>();
    public static class Grupo {
        public OrdenResponse anterior;
        public List<Linea> items = new ArrayList<>();
    }
    public static class Linea {
        public OrdenItemResponse anterior;
        public CatalogoCompras.Oferta cotizacion;
        public UUID reservaId;
        public boolean solicitada;
        public boolean liberada;
    }
}
