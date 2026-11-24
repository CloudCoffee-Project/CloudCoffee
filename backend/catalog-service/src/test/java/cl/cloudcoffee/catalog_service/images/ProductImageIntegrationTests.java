package cl.cloudcoffee.catalog_service.images;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import cl.cloudcoffee.catalog_service.repository.ProductRepository;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import com.nimbusds.jose.JWSAlgorithm;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "management.tracing.enabled=false",
    "spring.datasource.url=jdbc:h2:mem:product-images;DB_CLOSE_DELAY=-1",
    "spring.datasource.username=sa", "spring.datasource.password="
})
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class ProductImageIntegrationTests extends JwtTestSupport {
    private static final String PRODUCT = "33333333-3333-4333-8333-333333333333";
    private static final Path DIRECTORY = temporaryDirectory();
    @Autowired MockMvc mvc;
    @Autowired ProductRepository products;
    @DynamicPropertySource
    static void storage(DynamicPropertyRegistry registry) { registry.add("catalog.images.directory", DIRECTORY::toString); }

    @Test
    void uploadPersistsAndRemainsPublicAfterReopeningStorage() throws Exception {
        String json = mvc.perform(multipart("/catalog/productos/{id}/imagen", PRODUCT)
                .file(png("../../unsafe.png", "image/png"))
                .header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String url = products.findById(UUID.fromString(PRODUCT)).orElseThrow().getImageUrl();
        assertThat(json).contains(url);
        assertThat(url).matches("/v1/catalog/imagenes/[a-f0-9-]{36}\\.png");
        String key = url.substring(url.lastIndexOf('/') + 1);
        byte[] persisted = new ProductImageStorage(DIRECTORY.toString()).read(key);
        assertThat(ImageIO.read(new java.io.ByteArrayInputStream(persisted)).getWidth()).isEqualTo(8);
        mvc.perform(get(url.substring(3))).andExpect(status().isOk())
                .andExpect(content().contentType("image/png")).andExpect(content().bytes(persisted))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(head(url.substring(3))).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"CLIENTE", "CAJERO", "ADMIN_CAFETERIA"})
    void onlySuperAdminCanListOrUpload(String role) throws Exception {
        mvc.perform(multipart("/catalog/productos/{id}/imagen", PRODUCT).file(png("test.png", "image/png"))
                .header("Authorization", bearer(role))).andExpect(status().isForbidden());
        mvc.perform(get("/catalog/admin/imagenes/productos").header("Authorization", bearer(role)))
                .andExpect(status().isForbidden());
    }

    @Test
    void anonymousCannotWriteOrListButAdminCanSeeAllExistingProducts() throws Exception {
        mvc.perform(multipart("/catalog/productos/{id}/imagen", PRODUCT).file(png("test.png", "image/png")))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/catalog/admin/imagenes/productos")).andExpect(status().isUnauthorized());
        mvc.perform(get("/catalog/admin/imagenes/productos").header("Authorization", bearer("SUPER_ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content.length()").value(12));
    }

    @Test
    void rejectsFakeImagesMimeMismatchLargeFilesAndMissingProductWithoutChangingImage() throws Exception {
        String original = products.findById(UUID.fromString(PRODUCT)).orElseThrow().getImageUrl();
        for (MockMultipartFile file : new MockMultipartFile[]{
                new MockMultipartFile("imagen", "fake.png", "image/png", "<script>alert(1)</script>".getBytes()),
                png("mismatch.jpg", "image/jpeg"),
                new MockMultipartFile("imagen", "large.png", "image/png", new byte[5 * 1024 * 1024 + 1])}) {
            mvc.perform(multipart("/catalog/productos/{id}/imagen", PRODUCT).file(file)
                    .header("Authorization", bearer("SUPER_ADMIN")))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("IMAGE_INVALID"));
        }
        mvc.perform(multipart("/catalog/productos/{id}/imagen", UUID.randomUUID()).file(png("test.png", "image/png"))
                .header("Authorization", bearer("SUPER_ADMIN"))).andExpect(status().isNotFound());
        assertThat(products.findById(UUID.fromString(PRODUCT)).orElseThrow().getImageUrl()).isEqualTo(original);
        mvc.perform(get("/catalog/imagenes/not-an-image.png")).andExpect(status().isNotFound());
    }

    private static MockMultipartFile png(String filename, String mime) throws Exception {
        var bytes = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), "png", bytes);
        return new MockMultipartFile("imagen", filename, mime, bytes.toByteArray());
    }
    private static String bearer(String role) { return "Bearer " + sign(claims().claim("role", role).build(), KEYS, JWSAlgorithm.RS256); }
    private static Path temporaryDirectory() {
        try { return Files.createTempDirectory("product-images-test-"); }
        catch (java.io.IOException error) { throw new IllegalStateException(error); }
    }
}
