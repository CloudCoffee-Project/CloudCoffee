package cl.cloudcoffee.notification_service.push;

import com.google.firebase.messaging.FirebaseMessagingException;

import java.util.Map;

public interface FcmPushGateway {

    void send(String token, String title, String body, Map<String, String> data)
            throws FirebaseMessagingException;
}
