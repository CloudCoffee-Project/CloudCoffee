package cl.cloudcoffee.catalog_service.images;

import cl.cloudcoffee.errors.BusinessException;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import javax.imageio.ImageIO;
import javax.imageio.stream.ImageInputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/** Archivos de imagen inmutables, independientes del nombre recibido del navegador. */
@Component
public class ProductImageStorage {
    private final Path directory;
    public ProductImageStorage(@Value("${catalog.images.directory:./data/product-images}") String directory) {
        this.directory = Path.of(directory).toAbsolutePath().normalize();
    }
    public record Stored(String key) {}
    public Stored store(MultipartFile file) {
        if (file.isEmpty() || file.getSize() > 5 * 1024 * 1024) throw invalid("La imagen debe tener entre 1 byte y 5 MB.");
        if (!Set.of("image/jpeg", "image/png").contains(Objects.toString(file.getContentType(), ""))) throw invalid("Solo se admite JPEG o PNG.");
        BufferedImage image = decode(file);
        try {
            // Recodificar elimina metadata/contenido ajeno a la imagen y fija el MIME servido.
            var output = new ByteArrayOutputStream();
            ImageIO.write(image, "png", output);
            byte[] bytes = output.toByteArray();
            if (bytes.length > 8 * 1024 * 1024) throw invalid("La imagen procesada es demasiado grande.");
            Files.createDirectories(directory);
            String key = UUID.randomUUID() + ".png";
            Path temporary = Files.createTempFile(directory, "upload-", ".tmp");
            try {
                Files.write(temporary, bytes);
                try { Files.move(temporary, directory.resolve(key), StandardCopyOption.ATOMIC_MOVE); }
                catch (AtomicMoveNotSupportedException unsupported) { Files.move(temporary, directory.resolve(key)); }
            } finally { Files.deleteIfExists(temporary); }
            return new Stored(key);
        } catch (IOException error) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "No se pudo guardar la imagen.", error);
        }
    }
    private static BufferedImage decode(MultipartFile file) {
        try (var source = file.getInputStream(); ImageInputStream input = ImageIO.createImageInputStream(source)) {
            if (input == null) throw invalid("La imagen no es válida.");
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalid("No se pudo reconocer la imagen.");
            var reader = readers.next();
            try {
                reader.setInput(input, true, true);
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                if (!(format.equals("png") || format.equals("jpeg")) || !file.getContentType().equals("image/" + format)) throw invalid("El contenido no coincide con el formato declarado.");
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 4096 || height > 4096 || (long) width * height > 4_000_000) throw invalid("La imagen admite hasta 4 millones de píxeles y 4096 px por lado.");
                BufferedImage image = reader.read(0);
                if (image == null) throw invalid("La imagen no es válida.");
                return image;
            } finally { reader.dispose(); }
        } catch (IOException error) { throw invalid("La imagen está dañada o incompleta."); }
    }
    public byte[] read(String key) {
        if (!key.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.png")) throw missing();
        try { return Files.readAllBytes(directory.resolve(key)); }
        catch (NoSuchFileException absent) { throw missing(); }
        catch (IOException error) { throw new IllegalStateException("No se pudo leer la imagen", error); }
    }
    public void discard(String key) {
        try { Files.deleteIfExists(directory.resolve(key)); }
        catch (IOException error) { /* Un huérfano se conserva; nunca se elimina una imagen ajena. */ }
    }
    private static BusinessException missing() { return new BusinessException(HttpStatus.NOT_FOUND, URI.create("/problems/image-not-found"), "Imagen no encontrada", "La imagen solicitada no existe.", "IMAGE_NOT_FOUND"); }
    static BusinessException invalid(String detail) { return new BusinessException(HttpStatus.BAD_REQUEST, URI.create("/problems/image-invalid"), "Imagen inválida", detail, "IMAGE_INVALID"); }
}
