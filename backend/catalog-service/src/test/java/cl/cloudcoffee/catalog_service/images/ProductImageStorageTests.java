package cl.cloudcoffee.catalog_service.images;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import cl.cloudcoffee.errors.BusinessException;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.server.ResponseStatusException;

class ProductImageStorageTests {
    @TempDir Path directory;
    @Test
    void rejectsOversizedDimensionsCorruptDataAndPathsOutsideStorage() throws Exception {
        var storage = new ProductImageStorage(directory.toString());
        var output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(4097, 1, BufferedImage.TYPE_INT_RGB), "png", output);
        assertThatThrownBy(() -> storage.store(new MockMultipartFile("imagen", "wide.png", "image/png", output.toByteArray())))
                .isInstanceOf(BusinessException.class).hasMessageContaining("4096");
        assertThatThrownBy(() -> storage.store(new MockMultipartFile("imagen", "corrupt.png", "image/png", new byte[]{(byte)137,80,78,71,13,10,26,10})))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> storage.read("../secret.png")).isInstanceOf(BusinessException.class);
    }
    @Test
    void unavailableDiskBecomesServiceUnavailable() throws Exception {
        Path file = Files.createFile(directory.resolve("not-a-directory"));
        var storage = new ProductImageStorage(file.toString());
        var output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(1, 1, BufferedImage.TYPE_INT_RGB), "png", output);
        assertThatThrownBy(() -> storage.store(new MockMultipartFile("imagen", "a.png", "image/png", output.toByteArray())))
                .isInstanceOfSatisfying(ResponseStatusException.class, error -> org.assertj.core.api.Assertions.assertThat(error.getStatusCode().value()).isEqualTo(503));
    }
}
