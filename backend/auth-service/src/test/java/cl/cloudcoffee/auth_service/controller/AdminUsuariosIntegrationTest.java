package cl.cloudcoffee.auth_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.messaging.CloudCoffeeEvent;
import cl.cloudcoffee.auth_service.model.AsignacionCafeteria;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.TipoToken;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.auth_service.repository.TokenAuthRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.auth_service.service.CatalogoCafeterias;
import cl.cloudcoffee.auth_service.service.ComprasEnCurso;
import cl.cloudcoffee.auth_service.service.JwtTokenService;
import cl.cloudcoffee.auth_service.service.LoginService;
import cl.cloudcoffee.auth_service.service.OperacionPendienteException;
import cl.cloudcoffee.security.testing.JwtTestSupport;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** INT2-121: administración de cuentas por SUPER_ADMIN según el contrato INT2-109. */
@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false", "management.tracing.enabled=false"})
@AutoConfigureMockMvc
class AdminUsuariosIntegrationTest extends JwtTestSupport {

    static final UUID CAFETERIA = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final UUID OTRA_CAFETERIA = UUID.fromString("55555555-5555-4555-8555-555555555555");
    static final String PASSWORD = "ClaveSegura2026";

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired MockMvc mvc;
    @Autowired UsuarioRepository usuarios;
    @Autowired AsignacionCafeteriaRepository asignaciones;
    @Autowired TokenAuthRepository tokens;
    @Autowired JwtTokenService jwtTokenService;
    @Autowired LoginService loginService;
    @Autowired PasswordEncoder passwordEncoder;
    @MockitoBean RabbitTemplate rabbitTemplate;
    @MockitoBean CatalogoCafeterias catalogo;
    @MockitoBean ComprasEnCurso comprasEnCurso;

    final JsonMapper json = JsonMapper.builder().build();
    Usuario superAdmin;
    String prefijo;

    @BeforeEach
    void setUp() {
        reset(rabbitTemplate, catalogo, comprasEnCurso);
        when(catalogo.consultar(CAFETERIA)).thenReturn(Optional.of(new CatalogoCafeterias.Cafeteria(CAFETERIA, true)));
        when(catalogo.consultar(OTRA_CAFETERIA))
                .thenReturn(Optional.of(new CatalogoCafeterias.Cafeteria(OTRA_CAFETERIA, true)));
        prefijo = "t" + UUID.randomUUID().toString().substring(0, 8);
        superAdmin = cuenta(Rol.SUPER_ADMIN, null);
    }

    // ------------------------------------------------------------------ acceso

    @Test
    void withoutJwtTheAdministrationIsUnauthorized() throws Exception {
        mvc.perform(get("/auth/admin/usuarios")).andExpect(status().isUnauthorized());
        mvc.perform(post("/auth/admin/personal").header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON).content(alta("a@uct.cl"))).andExpect(status().isUnauthorized());
    }

    @ParameterizedTest
    @EnumSource(value = Rol.class, names = {"CLIENTE", "CAJERO", "ADMIN_CAFETERIA"})
    void onlySuperAdminAdministersAccounts(Rol rol) throws Exception {
        Usuario actor = cuenta(rol, rol == Rol.CLIENTE ? null : CAFETERIA);
        Usuario objetivo = cuenta(Rol.CAJERO, CAFETERIA);
        mvc.perform(get("/auth/admin/usuarios").header("Authorization", jwt(actor)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
        mvc.perform(post("/auth/admin/usuarios/" + objetivo.getId() + "/desactivar").header("Authorization", jwt(actor)))
                .andExpect(status().isForbidden());
        crear(actor, UUID.randomUUID(), alta(prefijo + "@uct.cl")).andExpect(status().isForbidden());
        assertThat(recargar(objetivo).isActivo()).isTrue();
        assertThat(usuarios.findByEmailIgnoreCase(prefijo + "@uct.cl")).isEmpty();
    }

    @Test
    void aDeactivatedSuperAdminLosesAdministrationBeforeItsJwtExpires() throws Exception {
        String token = jwt(superAdmin);
        Usuario otro = cuenta(Rol.SUPER_ADMIN, null);
        mvc.perform(post("/auth/admin/usuarios/" + superAdmin.getId() + "/desactivar").header("Authorization", jwt(otro)))
                .andExpect(status().isOk());
        mvc.perform(get("/auth/admin/usuarios").header("Authorization", token))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
    }

    // ------------------------------------------------------------------ alta e invitación

    @Test
    void invitesStaffPendingActivationWithoutUsablePasswordAndPublishesTheInvitation() throws Exception {
        String email = prefijo + ".Cajera@UCT.cl";
        MvcResult resultado = crear(superAdmin, UUID.randomUUID(), alta(email))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Idempotency-Replayed", "false"))
                .andExpect(jsonPath("$.email").value(email.toLowerCase()))
                .andExpect(jsonPath("$.rol").value("CAJERO"))
                .andExpect(jsonPath("$.cafeteriaId").value(CAFETERIA.toString()))
                .andExpect(jsonPath("$.estado").value("pendiente_activacion"))
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.password").doesNotExist())
                .andReturn();
        UUID id = UUID.fromString(leer(resultado).path("usuarioId").asString());
        assertThat(resultado.getResponse().getHeader("Location")).isEqualTo("/v1/auth/admin/usuarios/" + id);
        assertThat(asignaciones.findById(id)).map(AsignacionCafeteria::getCafeteriaId).contains(CAFETERIA);

        CloudCoffeeEvent invitacion = eventoPublicado(AuthEventPublisher.INVITACION_PERSONAL_EVENT);
        assertThat(invitacion.traceId()).matches("[0-9a-f]{32}");
        assertThat(invitacion.payload()).containsEntry("usuarioId", id.toString())
                .containsEntry("email", email.toLowerCase()).containsEntry("rol", "CAJERO")
                .containsEntry("cafeteriaId", CAFETERIA.toString()).containsKey("expiresAt");
        assertThat((String) invitacion.payload().get("token")).matches("[A-Za-z0-9_-]{43}");

        // Nadie conoce una contraseña: no hay login posible antes de activar.
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email.toLowerCase() + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void repeatingTheSameKeyReplaysOneAccountAndOneInvitation() throws Exception {
        UUID clave = UUID.randomUUID();
        String cuerpo = alta(prefijo + "@uct.cl");
        String primero = crear(superAdmin, clave, cuerpo).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String segundo = crear(superAdmin, clave, cuerpo).andExpect(status().isCreated())
                .andExpect(header().string("Idempotency-Replayed", "true"))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(segundo).path("usuarioId")).isEqualTo(json.readTree(primero).path("usuarioId"));
        verify(rabbitTemplate, times(1)).convertAndSend(anyString(), eq(AuthEventPublisher.INVITACION_PERSONAL_EVENT), any(Object.class));
        verify(catalogo, times(1)).consultar(CAFETERIA);

        crear(superAdmin, clave, alta(prefijo + "otro@uct.cl"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
        assertThat(usuarios.findByEmailIgnoreCase(prefijo + "otro@uct.cl")).isEmpty();
    }

    @Test
    void concurrentRequestsWithTheSameKeyCreateASingleAccount() throws Exception {
        UUID clave = UUID.randomUUID();
        String cuerpo = alta(prefijo + "@uct.cl");
        List<Integer> estados = enParalelo(4, () -> crear(superAdmin, clave, cuerpo).andReturn().getResponse().getStatus());
        assertThat(estados).containsOnly(201);
        assertThat(usuarios.findByEmailIgnoreCase(prefijo + "@uct.cl")).isPresent();
        verify(rabbitTemplate, times(1)).convertAndSend(anyString(), eq(AuthEventPublisher.INVITACION_PERSONAL_EVENT), any(Object.class));
    }

    @Test
    void neverAcceptsAPasswordAnArbitraryRoleOrAMissingCafeteria() throws Exception {
        String base = "{\"email\":\"" + prefijo + "@uct.cl\",\"nombre\":\"Ana\",\"apellido\":\"Pérez\","
                + "\"telefono\":\"+56912345678\"";
        crear(superAdmin, UUID.randomUUID(), base + ",\"rol\":\"CAJERO\",\"cafeteriaId\":\"" + CAFETERIA
                + "\",\"password\":\"Conocida123\"}").andExpect(status().isBadRequest());
        for (String rol : List.of("SUPER_ADMIN", "CLIENTE", "cajero")) {
            crear(superAdmin, UUID.randomUUID(), base + ",\"rol\":\"" + rol + "\",\"cafeteriaId\":\"" + CAFETERIA + "\"}")
                    .andExpect(status().isBadRequest());
        }
        crear(superAdmin, UUID.randomUUID(), base + ",\"rol\":\"CAJERO\"}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SOLICITUD_INVALIDA"));
        mvc.perform(post("/auth/admin/personal").header("Authorization", jwt(superAdmin))
                .header("Idempotency-Key", "no-es-uuid").contentType(MediaType.APPLICATION_JSON).content(alta(prefijo + "@uct.cl")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_INVALIDA"));
        assertThat(usuarios.findByEmailIgnoreCase(prefijo + "@uct.cl")).isEmpty();
    }

    @Test
    void anExistingEmailIsNeverTurnedIntoStaff() throws Exception {
        Usuario cliente = cuenta(Rol.CLIENTE, null);
        crear(superAdmin, UUID.randomUUID(), alta(cliente.getEmail().toUpperCase()))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EMAIL_YA_REGISTRADO"));
        assertThat(recargar(cliente).getRol()).isEqualTo(Rol.CLIENTE);
        verify(rabbitTemplate, never()).convertAndSend(anyString(), eq(AuthEventPublisher.INVITACION_PERSONAL_EVENT), any(Object.class));
    }

    @Test
    void theCafeteriaIsValidatedWithCatalogAndFailsClosed() throws Exception {
        UUID inexistente = UUID.randomUUID();
        UUID dadaDeBaja = UUID.randomUUID();
        UUID caida = UUID.randomUUID();
        when(catalogo.consultar(inexistente)).thenReturn(Optional.empty());
        when(catalogo.consultar(dadaDeBaja)).thenReturn(Optional.of(new CatalogoCafeterias.Cafeteria(dadaDeBaja, false)));
        when(catalogo.consultar(caida)).thenThrow(new OperacionPendienteException("Catalog no responde."));

        crear(superAdmin, UUID.randomUUID(), alta(prefijo + "@uct.cl", "CAJERO", inexistente))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("CAFETERIA_NO_ENCONTRADA"));
        crear(superAdmin, UUID.randomUUID(), alta(prefijo + "@uct.cl", "CAJERO", dadaDeBaja))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CAFETERIA_DADA_DE_BAJA"));
        crear(superAdmin, UUID.randomUUID(), alta(prefijo + "@uct.cl", "CAJERO", caida))
                .andExpect(status().isServiceUnavailable())
                .andExpect(header().string("Retry-After", "2"))
                .andExpect(jsonPath("$.code").value("OPERACION_PENDIENTE"));
        assertThat(usuarios.findByEmailIgnoreCase(prefijo + "@uct.cl")).isEmpty();
    }

    // ------------------------------------------------------------------ activación

    @Test
    void theInviteeDefinesTheirPasswordOnceAndCanLogIn() throws Exception {
        String email = prefijo + "@uct.cl";
        crear(superAdmin, UUID.randomUUID(), alta(email, "ADMIN_CAFETERIA", CAFETERIA)).andExpect(status().isCreated());
        String token = tokenInvitacion();

        activar(token, "corta").andExpect(status().isBadRequest());
        activar(token, PASSWORD).andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email)).andExpect(jsonPath("$.rol").value("ADMIN_CAFETERIA"));
        activar(token, PASSWORD).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TOKEN_ACTIVACION_INVALIDO"));

        assertThat(loginService.iniciarSesion(email, PASSWORD).accessToken()).isNotBlank();
        Usuario activada = usuarios.findByEmailIgnoreCase(email).orElseThrow();
        mvc.perform(get("/auth/admin/usuarios/" + activada.getId()).header("Authorization", jwt(superAdmin)))
                .andExpect(jsonPath("$.estado").value("activa"));
    }

    @Test
    void resendingTheInvitationRevokesThePreviousToken() throws Exception {
        String email = prefijo + "@uct.cl";
        String id = leer(crear(superAdmin, UUID.randomUUID(), alta(email)).andReturn()).path("usuarioId").asString();
        String anterior = tokenInvitacion();
        clearInvocations(rabbitTemplate);

        mvc.perform(post("/auth/admin/usuarios/" + id + "/invitacion").header("Authorization", jwt(superAdmin)))
                .andExpect(status().isAccepted());
        String nuevo = tokenInvitacion();

        assertThat(nuevo).isNotEqualTo(anterior);
        activar(anterior, PASSWORD).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TOKEN_ACTIVACION_INVALIDO"));
        activar(nuevo, PASSWORD).andExpect(status().isOk());
        // Una cuenta ya activa no recibe otra invitación.
        mvc.perform(post("/auth/admin/usuarios/" + id + "/invitacion").header("Authorization", jwt(superAdmin)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ESTADO_INVALIDO"));
    }

    @Test
    void expiredOrUnknownTokensAndDeactivatedAccountsCannotActivate() throws Exception {
        activar("A".repeat(43), PASSWORD).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TOKEN_ACTIVACION_INVALIDO"));
        activar("demasiado-corto", PASSWORD).andExpect(status().isBadRequest());

        String id = leer(crear(superAdmin, UUID.randomUUID(), alta(prefijo + "@uct.cl")).andReturn()).path("usuarioId").asString();
        String token = tokenInvitacion();
        mvc.perform(post("/auth/admin/usuarios/" + id + "/desactivar").header("Authorization", jwt(superAdmin)))
                .andExpect(status().isOk());
        activar(token, PASSWORD).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ESTADO_INVALIDO"));

        String otro = leer(crear(superAdmin, UUID.randomUUID(), alta(prefijo + "b@uct.cl")).andReturn()).path("usuarioId").asString();
        String vencido = tokenInvitacion();
        var pendientes = tokens.findByUsuarioIdAndTipoAndRevokedAtIsNull(UUID.fromString(otro), TipoToken.ACTIVACION_CUENTA);
        pendientes.forEach(t -> ReflectionTestUtils.setField(t, "expiresAt", Instant.now().minusSeconds(1)));
        tokens.saveAllAndFlush(pendientes);
        activar(vencido, PASSWORD).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("TOKEN_ACTIVACION_INVALIDO"));
    }

    @Test
    void staffCannotBypassTheInvitationWithTheClientVerificationFlow() throws Exception {
        String email = prefijo + "@uct.cl";
        crear(superAdmin, UUID.randomUUID(), alta(email)).andExpect(status().isCreated());
        mvc.perform(post("/auth/verificacion/reenviar").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}")).andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ listado y consulta

    @Test
    void listsAndSearchesAccountsWithStableOrderAndPagination() throws Exception {
        String busqueda = "l" + prefijo;
        Usuario cajero = cuenta(Rol.CAJERO, CAFETERIA, busqueda + "b@uct.cl");
        Usuario admin = cuenta(Rol.ADMIN_CAFETERIA, OTRA_CAFETERIA, busqueda + "a@uct.cl");
        Usuario inactivo = cuenta(Rol.CAJERO, CAFETERIA, busqueda + "c@uct.cl");
        inactivo.desactivar();
        usuarios.saveAndFlush(inactivo);
        Usuario eliminado = cuenta(Rol.CAJERO, CAFETERIA, busqueda + "d@uct.cl");
        mvc.perform(post("/auth/admin/usuarios/" + eliminado.getId() + "/baja").header("Authorization", jwt(superAdmin)))
                .andExpect(status().isOk());

        listar("q=" + busqueda).andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.content[0].usuarioId").value(admin.getId().toString()))
                .andExpect(jsonPath("$.content[0].cafeteriaId").value(OTRA_CAFETERIA.toString()))
                .andExpect(jsonPath("$.content[1].usuarioId").value(cajero.getId().toString()))
                .andExpect(jsonPath("$.content[2].estado").value("inactiva"));
        listar("q=" + busqueda + "&rol=CAJERO&estado=activa")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].usuarioId").value(cajero.getId().toString()));
        listar("q=" + busqueda + "&cafeteriaId=" + OTRA_CAFETERIA)
                .andExpect(jsonPath("$.totalElements").value(1));
        listar("q=" + busqueda + "&size=2&page=1")
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.number").value(1)).andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalPages").value(2)).andExpect(jsonPath("$.first").value(false))
                .andExpect(jsonPath("$.last").value(true));
        // Los comodines de LIKE se buscan literalmente.
        listar("q=" + busqueda.substring(0, 3) + "%25").andExpect(jsonPath("$.totalElements").value(0));

        for (String invalido : List.of("size=0", "size=101", "page=-1", "estado=eliminada", "rol=ROOT",
                "cafeteriaId=x", "q=a")) {
            listar(invalido).andExpect(status().isBadRequest());
        }
        mvc.perform(get("/auth/admin/usuarios/" + eliminado.getId()).header("Authorization", jwt(superAdmin)))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("USUARIO_NO_ENCONTRADO"));
        mvc.perform(get("/auth/admin/usuarios/" + UUID.randomUUID()).header("Authorization", jwt(superAdmin)))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ ediciones

    @Test
    void editsContactDataWithOptimisticVersion() throws Exception {
        Usuario cajero = cuenta(Rol.CAJERO, CAFETERIA);
        editar(cajero, "{\"telefono\":\" +56987654321 \",\"nombre\":\" Ana María \",\"version\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.telefono").value("+56987654321"))
                .andExpect(jsonPath("$.nombre").value("Ana María"))
                .andExpect(jsonPath("$.version").value(2));
        editar(cajero, "{\"telefono\":\"+56911111111\",\"version\":1}")
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("VERSION_CONFLICTO"));
        editar(cajero, "{\"email\":\"otro@uct.cl\",\"version\":2}").andExpect(status().isBadRequest());
        editar(cajero, "{\"rol\":\"SUPER_ADMIN\",\"version\":2}").andExpect(status().isBadRequest());
        editar(cajero, "{\"nombre\":\"   \",\"version\":2}").andExpect(status().isBadRequest());
        editar(cajero, "{\"telefono\":\"+56911111111\"}").andExpect(status().isBadRequest());
        assertThat(recargar(cajero).getTelefono()).isEqualTo("+56987654321");
        assertThat(recargar(cajero).getRol()).isEqualTo(Rol.CAJERO);
    }

    @Test
    void reassigningRevokesSessionsAndTheNewCafeteriaRulesTheNextRequest() throws Exception {
        Usuario cajero = cuentaConPassword(Rol.CAJERO, CAFETERIA);
        String refresh = loginService.iniciarSesion(cajero.getEmail(), PASSWORD).refreshToken();

        asignar(cajero, OTRA_CAFETERIA, 1).andExpect(status().isOk())
                .andExpect(jsonPath("$.cafeteriaId").value(OTRA_CAFETERIA.toString()))
                .andExpect(jsonPath("$.version").value(2));
        asignacionInterna(cajero).andExpect(jsonPath("$.cafeteriaId").value(OTRA_CAFETERIA.toString()));
        refrescar(refresh).andExpect(status().isUnauthorized());

        asignar(cajero, CAFETERIA, 1).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("VERSION_CONFLICTO"));
        // Repetir la misma asignación no cambia nada ni consulta a Catalog.
        clearInvocations(catalogo);
        asignar(cajero, OTRA_CAFETERIA, 2).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));
        verify(catalogo, never()).consultar(any());

        Usuario cliente = cuenta(Rol.CLIENTE, null);
        asignar(cliente, CAFETERIA, 1).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("ESTADO_INVALIDO"));
        assertThat(asignaciones.findById(cliente.getId())).isEmpty();
    }

    // ------------------------------------------------------------------ transiciones

    @Test
    void deactivatingRevokesRefreshLoginAndAssignmentAndIsReversible() throws Exception {
        Usuario cajero = cuentaConPassword(Rol.CAJERO, CAFETERIA);
        String refresh = loginService.iniciarSesion(cajero.getEmail(), PASSWORD).refreshToken();

        transicion(cajero, "desactivar").andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("inactiva")).andExpect(jsonPath("$.version").value(2));
        refrescar(refresh).andExpect(status().isUnauthorized());
        asignacionInterna(cajero).andExpect(status().isNotFound());
        login(cajero).andExpect(status().isUnauthorized());
        // Repetible: sin cambios.
        transicion(cajero, "desactivar").andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));

        transicion(cajero, "reactivar").andExpect(status().isOk())
                .andExpect(jsonPath("$.estado").value("activa")).andExpect(jsonPath("$.version").value(3));
        transicion(cajero, "reactivar").andExpect(status().isOk()).andExpect(jsonPath("$.version").value(3));
        login(cajero).andExpect(status().isOk());
        asignacionInterna(cajero).andExpect(status().isOk());
    }

    @Test
    void aSuperAdminCannotDeactivateOrRemoveThemselves() throws Exception {
        for (String accion : List.of("desactivar", "reactivar", "baja")) {
            transicion(superAdmin, accion).andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("OPERACION_SOBRE_SI_MISMO"));
        }
        assertThat(recargar(superAdmin).isActivo()).isTrue();
    }

    @Test
    void twoSuperAdminsDeactivatingEachOtherNeverLeaveThePlatformWithoutOne() throws Exception {
        // Se desactivan los demás SUPER_ADMIN de otras pruebas para que solo queden estos dos.
        usuarios.findAll().stream().filter(u -> u.getRol() == Rol.SUPER_ADMIN && u.isActivo()
                && !u.getId().equals(superAdmin.getId())).forEach(u -> { u.desactivar(); usuarios.saveAndFlush(u); });
        Usuario otro = cuenta(Rol.SUPER_ADMIN, null);
        String jwtA = jwt(superAdmin);
        String jwtB = jwt(otro);

        List<Integer> estados = enParalelo(2, new java.util.concurrent.atomic.AtomicInteger()::getAndIncrement,
                turno -> turno == 0
                        ? mvc.perform(post("/auth/admin/usuarios/" + otro.getId() + "/desactivar").header("Authorization", jwtA))
                                .andReturn().getResponse().getStatus()
                        : mvc.perform(post("/auth/admin/usuarios/" + superAdmin.getId() + "/desactivar").header("Authorization", jwtB))
                                .andReturn().getResponse().getStatus());

        assertThat(estados).contains(200).filteredOn(s -> s != 200).allMatch(s -> s == 409 || s == 403);
        long activos = usuarios.findAll().stream().filter(u -> u.getRol() == Rol.SUPER_ADMIN && u.isActivo()).count();
        assertThat(activos).isEqualTo(1);
    }

    @Test
    void removingStaffAnonymizesKeepsTheIdAndFreesTheEmail() throws Exception {
        Usuario admin = cuentaConPassword(Rol.ADMIN_CAFETERIA, CAFETERIA);
        String email = admin.getEmail();
        String refresh = loginService.iniciarSesion(email, PASSWORD).refreshToken();

        transicion(admin, "baja").andExpect(status().isOk())
                .andExpect(jsonPath("$.usuarioId").value(admin.getId().toString()))
                .andExpect(jsonPath("$.email").value("eliminado+" + admin.getId() + "@anonimo.invalid"))
                .andExpect(jsonPath("$.cafeteriaId").value((Object) null))
                .andExpect(jsonPath("$.estado").value("inactiva"));
        Usuario anonima = recargar(admin);
        assertThat(anonima.isEliminado()).isTrue();
        assertThat(anonima.getNombre()).isEqualTo("Usuario");
        assertThat(anonima.getTelefono()).isEqualTo("000000");
        assertThat(passwordEncoder.matches(PASSWORD, anonima.getPasswordHash())).isFalse();
        assertThat(tokens.findByUsuarioIdAndRevokedAtIsNull(admin.getId())).isEmpty();
        assertThat(asignaciones.findById(admin.getId())).isEmpty();
        refrescar(refresh).andExpect(status().isUnauthorized());

        CloudCoffeeEvent evento = eventoPublicado(AuthEventPublisher.USUARIO_ANONIMIZADO_EVENT);
        assertThat(evento.payload()).containsEntry("usuarioId", admin.getId().toString())
                .containsEntry("rolAnterior", "ADMIN_CAFETERIA").containsEntry("origen", "baja_administrativa")
                .doesNotContainKey("email");

        // Repetible: sin cambios ni otro evento.
        transicion(admin, "baja").andExpect(status().isOk());
        verify(rabbitTemplate, times(1)).convertAndSend(anyString(), eq(AuthEventPublisher.USUARIO_ANONIMIZADO_EVENT), any(Object.class));
        transicion(admin, "reactivar").andExpect(status().isNotFound());

        // El correo queda libre para una cuenta nueva, sin vínculo con la anterior.
        crear(superAdmin, UUID.randomUUID(), alta(email)).andExpect(status().isCreated());
    }

    @Test
    void clientAccountsAreRemovedOnlyWithoutPurchasesInProgress() throws Exception {
        // INT2-129: misma regla que la baja propia; Order decide si hay compras sin cerrar.
        Usuario cliente = cuenta(Rol.CLIENTE, null);
        when(comprasEnCurso.contar(cliente.getId())).thenReturn(2L);
        transicion(cliente, "baja").andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("COMPRAS_EN_CURSO"));
        when(comprasEnCurso.contar(cliente.getId())).thenThrow(new OperacionPendienteException("Order no responde."));
        transicion(cliente, "baja").andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("OPERACION_PENDIENTE"));
        assertThat(recargar(cliente).isEliminado()).isFalse();
        verify(rabbitTemplate, never()).convertAndSend(anyString(), eq(AuthEventPublisher.USUARIO_ANONIMIZADO_EVENT), any(Object.class));

        reset(comprasEnCurso);
        transicion(cliente, "baja").andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("eliminado+" + cliente.getId() + "@anonimo.invalid"));
        assertThat(eventoPublicado(AuthEventPublisher.USUARIO_ANONIMIZADO_EVENT).payload())
                .containsEntry("rolAnterior", "CLIENTE").containsEntry("origen", "baja_administrativa");
    }

    // ------------------------------------------------------------------ apoyo

    private Usuario cuenta(Rol rol, UUID cafeteria) {
        return cuenta(rol, cafeteria, prefijo + "-" + UUID.randomUUID() + "@uct.cl");
    }

    private Usuario cuenta(Rol rol, UUID cafeteria, String email) {
        Usuario usuario = new Usuario(email, passwordEncoder.encode(PASSWORD), rol, "Ana", "Pérez", "+56912345678");
        usuario.verificar();
        usuario = usuarios.saveAndFlush(usuario);
        if (cafeteria != null) asignaciones.saveAndFlush(new AsignacionCafeteria(usuario.getId(), cafeteria));
        return usuario;
    }

    private Usuario cuentaConPassword(Rol rol, UUID cafeteria) {
        return cuenta(rol, cafeteria);
    }

    private Usuario recargar(Usuario usuario) {
        return usuarios.findById(usuario.getId()).orElseThrow();
    }

    private String jwt(Usuario usuario) {
        return "Bearer " + jwtTokenService.emitir(usuario);
    }

    private String alta(String email) {
        return alta(email, "CAJERO", CAFETERIA);
    }

    private static String alta(String email, String rol, UUID cafeteria) {
        return "{\"email\":\"" + email + "\",\"nombre\":\" Ana \",\"apellido\":\"Pérez\",\"telefono\":\"+56912345678\","
                + "\"rol\":\"" + rol + "\",\"cafeteriaId\":\"" + cafeteria + "\"}";
    }

    private ResultActions crear(Usuario actor, UUID clave, String cuerpo) throws Exception {
        return mvc.perform(post("/auth/admin/personal").header("Authorization", jwt(actor))
                .header("Idempotency-Key", clave.toString()).contentType(MediaType.APPLICATION_JSON).content(cuerpo));
    }

    private ResultActions listar(String query) throws Exception {
        return mvc.perform(get("/auth/admin/usuarios?" + query).header("Authorization", jwt(superAdmin)));
    }

    private ResultActions editar(Usuario usuario, String cuerpo) throws Exception {
        return mvc.perform(patch("/auth/admin/usuarios/" + usuario.getId()).header("Authorization", jwt(superAdmin))
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo));
    }

    private ResultActions asignar(Usuario usuario, UUID cafeteria, long version) throws Exception {
        return mvc.perform(put("/auth/admin/usuarios/" + usuario.getId() + "/asignacion")
                .header("Authorization", jwt(superAdmin)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"cafeteriaId\":\"" + cafeteria + "\",\"version\":" + version + "}"));
    }

    private ResultActions transicion(Usuario usuario, String accion) throws Exception {
        return mvc.perform(post("/auth/admin/usuarios/" + usuario.getId() + "/" + accion)
                .header("Authorization", jwt(superAdmin)));
    }

    private ResultActions activar(String token, String password) throws Exception {
        return mvc.perform(post("/auth/activacion").contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\",\"password\":\"" + password + "\"}"));
    }

    private ResultActions login(Usuario usuario) throws Exception {
        return mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + usuario.getEmail() + "\",\"password\":\"" + PASSWORD + "\"}"));
    }

    private ResultActions refrescar(String refresh) throws Exception {
        return mvc.perform(post("/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + refresh + "\"}"));
    }

    private ResultActions asignacionInterna(Usuario usuario) throws Exception {
        return mvc.perform(get("/internal/servicios/asignaciones/" + usuario.getId())
                .header("X-Internal-Service-Token", INTERNAL_TOKEN));
    }

    private CloudCoffeeEvent eventoPublicado(String tipo) {
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(rabbitTemplate, org.mockito.Mockito.atLeastOnce()).convertAndSend(anyString(), eq(tipo), captor.capture());
        return (CloudCoffeeEvent) captor.getValue();
    }

    private String tokenInvitacion() {
        return (String) eventoPublicado(AuthEventPublisher.INVITACION_PERSONAL_EVENT).payload().get("token");
    }

    private JsonNode leer(MvcResult resultado) throws Exception {
        return json.readTree(resultado.getResponse().getContentAsString());
    }

    interface Accion {
        int ejecutar() throws Exception;
    }

    interface AccionPorTurno {
        int ejecutar(int turno) throws Exception;
    }

    private static List<Integer> enParalelo(int hilos, Accion accion) throws Exception {
        return enParalelo(hilos, () -> 0, turno -> accion.ejecutar());
    }

    private static List<Integer> enParalelo(int hilos, java.util.function.IntSupplier turnos, AccionPorTurno accion)
            throws Exception {
        CountDownLatch salida = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(hilos)) {
            List<Future<Integer>> futuros = new ArrayList<>();
            for (int i = 0; i < hilos; i++) {
                int turno = turnos.getAsInt();
                futuros.add(pool.submit(() -> {
                    salida.await();
                    return accion.ejecutar(turno);
                }));
            }
            salida.countDown();
            List<Integer> estados = new ArrayList<>();
            for (Future<Integer> futuro : futuros) estados.add(futuro.get());
            return estados;
        }
    }
}
