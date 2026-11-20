package cl.cloudcoffee.notification_service.push;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.Notification;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;

@Configuration
@ConditionalOnProperty(name = "app.fcm.enabled", havingValue = "true")
public class FirebasePushConfiguration {

    @Bean(destroyMethod = "delete")
    FirebaseApp notificationFirebaseApp(
            @Value("${app.fcm.credentials-file:}") String credentialsFile,
            @Value("${app.fcm.credentials-json:}") String credentialsJson) {
        if (credentialsFile.isBlank() && credentialsJson.isBlank()) {
            throw new IllegalStateException(
                    "FCM está habilitado pero no se configuraron credenciales de Firebase Admin.");
        }
        if (credentialsJson.isBlank() && !Files.isRegularFile(Path.of(credentialsFile))) {
            throw new IllegalStateException("No se encontró el archivo de credenciales FCM configurado.");
        }
        try (InputStream input = credentialsJson.isBlank()
                ? Files.newInputStream(Path.of(credentialsFile))
                : new ByteArrayInputStream(credentialsJson.getBytes(StandardCharsets.UTF_8))) {
            FirebaseOptions options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.fromStream(input))
                    .build();
            return FirebaseApp.initializeApp(options, "cloudcoffee-notification");
        } catch (IOException exception) {
            throw new IllegalStateException("No se pudieron cargar las credenciales de Firebase.", exception);
        }
    }

    @Bean
    FcmPushGateway fcmPushGateway(FirebaseApp notificationFirebaseApp) {
        FirebaseMessaging messaging = FirebaseMessaging.getInstance(notificationFirebaseApp);
        return (token, title, body, data) -> {
            Message message = Message.builder()
                    .setToken(token)
                    .setNotification(Notification.builder().setTitle(title).setBody(body).build())
                    .putAllData(data)
                    .build();
            messaging.send(message);
        };
    }
}
