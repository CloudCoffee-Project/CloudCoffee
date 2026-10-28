package cl.cloudcoffee.notification_service.websocket;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cl.cloudcoffee.security.CafeteriaAccess;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class NotificationSubscriptionAuthorizerTests {

    private NotificationOrderAccessRepository orderAccessRepository;
    private NotificationPurchaseAccessRepository purchaseAccessRepository;
    private CafeteriaAccess cafeteriaAccess;
    private NotificationSubscriptionAuthorizer authorizer;

    @BeforeEach
    void setUp() {
        orderAccessRepository = mock(NotificationOrderAccessRepository.class);
        purchaseAccessRepository = mock(NotificationPurchaseAccessRepository.class);
        cafeteriaAccess = mock(CafeteriaAccess.class);
        authorizer = new NotificationSubscriptionAuthorizer(
                orderAccessRepository, purchaseAccessRepository, cafeteriaAccess);
    }

    @Test
    void compradorSoloPuedeSuscribirseASuCompraYOrden() {
        UUID userId = UUID.randomUUID();
        UUID purchaseId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID cafeteriaId = UUID.randomUUID();
        when(purchaseAccessRepository.findById(purchaseId))
                .thenReturn(Optional.of(new NotificationPurchaseAccess(purchaseId, userId)));
        when(orderAccessRepository.findById(orderId))
                .thenReturn(Optional.of(new NotificationOrderAccess(orderId, purchaseId, userId, cafeteriaId)));
        JwtAuthenticationToken client = authentication(userId, "CLIENTE");

        authorizer.authorize(client, "/topic/compra/" + purchaseId + "/estado");
        authorizer.authorize(client, "/topic/orden/" + orderId + "/estado");

        verify(purchaseAccessRepository).findById(purchaseId);
        verify(orderAccessRepository).findById(orderId);
        verifyNoInteractions(cafeteriaAccess);
    }

    @Test
    void compradorNoPuedeSuscribirseACompraAjena() {
        UUID buyerId = UUID.randomUUID();
        UUID ownerId = UUID.randomUUID();
        UUID purchaseId = UUID.randomUUID();
        when(purchaseAccessRepository.findById(purchaseId))
                .thenReturn(Optional.of(new NotificationPurchaseAccess(purchaseId, ownerId)));

        assertThatThrownBy(() -> authorizer.authorize(authentication(buyerId, "CLIENTE"),
                "/topic/compra/" + purchaseId + "/estado"))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void cajeroDebeTenerAsignacionVigenteParaSuCafeteria() {
        UUID userId = UUID.randomUUID();
        UUID cafeteriaId = UUID.randomUUID();
        JwtAuthenticationToken cashier = authentication(userId, "CAJERO");
        when(cafeteriaAccess.puedeOperar(cashier, cafeteriaId)).thenReturn(true);

        authorizer.authorize(cashier, "/topic/cafeteria/" + cafeteriaId + "/ordenes");
        authorizer.authorize(cashier, "/topic/cafeteria/" + cafeteriaId + "/stock");

        verify(cafeteriaAccess, org.mockito.Mockito.times(2)).puedeOperar(cashier, cafeteriaId);
    }

    @Test
    void administradorYComodinNoPuedenSuscribirseAOrdenesDeCafeteria() {
        UUID cafeteriaId = UUID.randomUUID();
        JwtAuthenticationToken admin = authentication(UUID.randomUUID(), "ADMIN_CAFETERIA");
        when(cafeteriaAccess.puedeOperar(admin, cafeteriaId)).thenReturn(true);

        assertThatThrownBy(() -> authorizer.authorize(admin,
                "/topic/cafeteria/" + cafeteriaId + "/ordenes"))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> authorizer.authorize(authentication(UUID.randomUUID(), "CAJERO"),
                "/topic/cafeteria/+/ordenes"))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void clienteAutenticadoPuedeSuscribirseAStockPeroNoAOrdenesAjenas() {
        UUID cafeteriaId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        JwtAuthenticationToken client = authentication(UUID.randomUUID(), "CLIENTE");

        authorizer.authorize(client, "/topic/cafeteria/" + cafeteriaId + "/stock");
        assertThatThrownBy(() -> authorizer.authorize(client, "/topic/orden/" + orderId + "/estado"))
                .isInstanceOf(AccessDeniedException.class);
    }

    private static JwtAuthenticationToken authentication(UUID userId, String role) {
        Jwt jwt = Jwt.withTokenValue("test-token")
                .header("alg", "RS256")
                .subject(userId.toString())
                .claim("role", role)
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(120))
                .build();
        return new JwtAuthenticationToken(jwt);
    }
}
