package cl.cloudcoffee.order_service.comprobantes;

import cl.cloudcoffee.order_service.model.Orden;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import org.apache.pdfbox.pdmodel.*;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Component;

/** Solo snapshots de Order: no consulta Catalog, Auth ni datos cambiantes del proveedor. */
@Component
public class ComprobantePdf {
    private static final DateTimeFormatter FECHA = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm")
            .withZone(ZoneId.of("America/Santiago"));

    public byte[] generar(Orden orden) {
        try (var doc = new PDDocument(); var fuente = getClass().getResourceAsStream("/fonts/DejaVuSans.ttf")) {
            var font = PDType0Font.load(doc, fuente);
            doc.getDocumentInformation().setTitle("Comprobante interno " + ComprobanteService.folio(orden.getId()));
            try (var pagina = new Pagina(doc, font, ComprobanteService.folio(orden.getId()))) {
                pagina.linea("CloudCoffee", 22);
                pagina.linea("Comprobante interno de compra", 16);
                pagina.linea("Sin validez tributaria. No es una boleta fiscal.", 10);
                pagina.espacio(12);
                pagina.linea("Folio: " + ComprobanteService.folio(orden.getId()), 10);
                pagina.linea("Fecha de compra: " + FECHA.format(orden.getCreatedAt()) + " (Chile)", 10);
                for (String texto : pagina.dividir("Cafetería: " + orden.getCafeteriaNombre(), 510, 11)) pagina.linea(texto, 11);
                pagina.espacio(12);
                pagina.cabecera();
                for (var item : orden.getItems().stream().sorted(Comparator.comparing(i -> i.getId().toString())).toList()) {
                    var lineas = pagina.dividir(item.getProductoNombre(), 250, 10);
                    float alto = Math.max(1, lineas.size()) * 15 + 10;
                    if (pagina.y - alto < 70) { pagina.nueva(); pagina.cabecera(); }
                    float inicio = pagina.y;
                    for (String linea : lineas) { pagina.texto(linea, 40, pagina.y, 10); pagina.y -= 15; }
                    pagina.texto(String.valueOf(item.getCantidad()), 305, inicio, 10);
                    pagina.derecha(pesos(item.getPrecioUnitario()), 420, inicio, 10);
                    pagina.derecha(pesos(item.getSubtotal()), 555, inicio, 10);
                    pagina.y = inicio - alto;
                }
                if (pagina.y < 110) pagina.nueva();
                pagina.espacio(15);
                pagina.texto("TOTAL CLP", 40, pagina.y, 14);
                pagina.derecha(pesos(orden.getMontoTotal()), 555, pagina.y, 16);
            }
            var salida = new ByteArrayOutputStream();
            doc.save(salida);
            return salida.toByteArray();
        } catch (IOException error) { throw new IllegalStateException("No se pudo generar el comprobante interno", error); }
    }

    private static String pesos(BigDecimal monto) {
        return "$" + NumberFormat.getIntegerInstance(Locale.of("es", "CL")).format(monto);
    }

    private static final class Pagina implements AutoCloseable {
        final PDDocument doc; final PDType0Font font; final String folio;
        PDPageContentStream contenido; float y; int numero;
        Pagina(PDDocument doc, PDType0Font font, String folio) throws IOException {
            this.doc = doc; this.font = font; this.folio = folio; nueva();
        }
        void nueva() throws IOException {
            if (contenido != null) { pie(); contenido.close(); }
            var page = new PDPage(PDRectangle.A4); doc.addPage(page);
            contenido = new PDPageContentStream(doc, page); y = 790; numero++;
            if (numero > 1) { linea("CloudCoffee - " + folio, 10); espacio(15); }
        }
        void cabecera() throws IOException {
            texto("Producto", 40, y, 10); texto("Cant.", 300, y, 10);
            derecha("Precio unitario", 420, y, 10); derecha("Subtotal CLP", 555, y, 10); espacio(25);
        }
        void linea(String s, float size) throws IOException { texto(s, 40, y, size); y -= size + 8; }
        void espacio(float alto) { y -= alto; }
        void derecha(String s, float x, float y, float size) throws IOException { texto(s, x - ancho(s, size), y, size); }
        float ancho(String s, float size) throws IOException { return font.getStringWidth(s) * size / 1000; }
        void texto(String s, float x, float y, float size) throws IOException {
            contenido.beginText(); contenido.setFont(font, size); contenido.newLineAtOffset(x, y); contenido.showText(s); contenido.endText();
        }
        List<String> dividir(String s, float maximo, float size) throws IOException {
            List<String> lineas = new ArrayList<>(); StringBuilder linea = new StringBuilder();
            // Mantener caracteres Unicode soportados y reemplazar solo glifos ausentes/control.
            for (int cp : s.codePoints().toArray()) {
                String c = Character.isISOControl(cp) ? " " : new String(Character.toChars(cp));
                try { font.encode(c); } catch (IllegalArgumentException error) { c = "?"; }
                if (!linea.isEmpty() && ancho(linea + c, size) > maximo) {
                    int espacio = linea.lastIndexOf(" ");
                    if (espacio > 0) {
                        lineas.add(linea.substring(0, espacio));
                        String resto = linea.substring(espacio + 1); linea.setLength(0); linea.append(resto);
                    } else { lineas.add(linea.toString()); linea.setLength(0); }
                }
                linea.append(c);
            }
            if (!linea.isEmpty()) lineas.add(linea.toString());
            return lineas;
        }
        void pie() throws IOException {
            texto("Comprobante interno - sin validez tributaria", 40, 35, 8);
            derecha("Página " + numero, 555, 35, 8);
        }
        @Override public void close() throws IOException { pie(); contenido.close(); }
    }
}
