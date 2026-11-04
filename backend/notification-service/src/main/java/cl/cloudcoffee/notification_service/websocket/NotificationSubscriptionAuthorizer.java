package cl.cloudcoffee.notification_service.websocket;

import cl.cloudcoffee.security.CafeteriaAccess;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

@Component
public class NotificationSubscriptionAuthorizer {

    private static final String UUID_PATTERN =
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    private static final Pattern ORDER_DESTINATION =
            Pattern.compile("^/topic/orden/(" + UUID_PATTERN + ")/estado$");
    private static final Pattern PURCHASE_DESTINATION =
            Pattern.compile("^/topic/compra/(" + UUID_PATTERN + ")/estado$");
    private static final Pattern CAFETERIA_ORDERS_DESTINATION =
            Pattern.compile("^/topic/cafeteria/(" + UUID_PATTERN + ")/ordenes$");
    private static final Pattern CAFETERIA_STOCK_DESTINATION =
            Pattern.compile("^/topic/cafeteria/(" + UUID_PATTERN + ")/stock$");

    private static final String CLIENT = "CLIENTE";
    private static final String CASHIER = "CAJERO";

    private final NotificationOrderAccessRepository orderAccessRepository;
    private final NotificationPurchaseAccessRepository purchaseAccessRepository;
    private final CafeteriaAccess cafeteriaAccess;

    public NotificationSubscriptionAuthorizer(
            NotificationOrderAccessRepository orderAccessRepository,
            NotificationPurchaseAccessRepository purchaseAccessRepository,
            CafeteriaAccess cafeteriaAccess
    ) {
        this.orderAccessRepository = orderAccessRepository;
        this.purchaseAccessRepository = purchaseAccessRepository;
        this.cafeteriaAccess = cafeteriaAccess;
    }

    public void authorize(Authentication authentication, String destination) {
        if (!(authentication instanceof JwtAuthenticationToken jwtAuthentication)
                || destination == null) {
            throw denied();
        }

        String role = jwtAuthentication.getToken().getClaimAsString("role");
        UUID userId = parseSubject(jwtAuthentication);
        Matcher matcher = ORDER_DESTINATION.matcher(destination);
        if (matcher.matches()) {
            authorizeOrder(jwtAuthentication, role, userId, UUID.fromString(matcher.group(1)));
            return;
        }

        matcher = PURCHASE_DESTINATION.matcher(destination);
        if (matcher.matches()) {
            if (!CLIENT.equals(role)
                    || purchaseAccessRepository.findById(UUID.fromString(matcher.group(1)))
                            .filter(access -> access.getClientId().equals(userId)).isEmpty()) {
                throw denied();
            }
            return;
        }

        matcher = CAFETERIA_ORDERS_DESTINATION.matcher(destination);
        if (matcher.matches()) {
            authorizeCashierForCafeteria(
                    jwtAuthentication, role, UUID.fromString(matcher.group(1)));
            return;
        }

        matcher = CAFETERIA_STOCK_DESTINATION.matcher(destination);
        if (matcher.matches()) {
            UUID cafeteriaId = UUID.fromString(matcher.group(1));
            if (CLIENT.equals(role)) {
                return;
            }
            authorizeCashierForCafeteria(jwtAuthentication, role, cafeteriaId);
            return;
        }
        throw denied();
    }

    private void authorizeOrder(
            JwtAuthenticationToken authentication,
            String role,
            UUID userId,
            UUID orderId
    ) {
        NotificationOrderAccess access = orderAccessRepository.findById(orderId).orElse(null);
        if (access == null) {
            throw denied();
        }
        if (CLIENT.equals(role) && access.getClientId().equals(userId)) {
            return;
        }
        if (CASHIER.equals(role)) {
            authorizeCashierForCafeteria(authentication, role, access.getCafeteriaId());
            return;
        }
        throw denied();
    }

    private void authorizeCashierForCafeteria(
            Authentication authentication,
            String role,
            UUID cafeteriaId
    ) {
        if (!CASHIER.equals(role) || !cafeteriaAccess.puedeOperar(authentication, cafeteriaId)) {
            throw denied();
        }
    }

    private static UUID parseSubject(JwtAuthenticationToken authentication) {
        try {
            return UUID.fromString(authentication.getToken().getSubject());
        } catch (IllegalArgumentException exception) {
            throw new AccessDeniedException("Identidad WebSocket inválida.", exception);
        }
    }

    private static AccessDeniedException denied() {
        return new AccessDeniedException("No está autorizado para suscribirse a este destino.");
    }
}
