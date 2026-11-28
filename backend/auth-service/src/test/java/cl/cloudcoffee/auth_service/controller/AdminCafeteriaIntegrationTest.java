package cl.cloudcoffee.auth_service.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import com.nimbusds.jose.JWSAlgorithm;

import cl.cloudcoffee.auth_service.messaging.AuthEventPublisher;
import cl.cloudcoffee.auth_service.model.AsignacionCafeteria;
import cl.cloudcoffee.auth_service.model.Rol;
import cl.cloudcoffee.auth_service.model.Usuario;
import cl.cloudcoffee.auth_service.repository.AsignacionCafeteriaRepository;
import cl.cloudcoffee.auth_service.repository.UsuarioRepository;
import cl.cloudcoffee.auth_service.service.CatalogoCafeterias;
import cl.cloudcoffee.auth_service.service.ComprasEnCurso;
import cl.cloudcoffee.auth_service.service.JwtTokenService;
import cl.cloudcoffee.auth_service.service.LoginService;
import cl.cloudcoffee.security.testing.JwtTestSupport;

/** INT2-122: ADMIN_CAFETERIA administra solo los CAJERO de su cafetería persistida en Auth. */
@SpringBootTest(properties = {"spring.rabbitmq.listener.simple.auto-startup=false",
        "management.health.rabbit.enabled=false", "management.tracing.enabled=false"})
@AutoConfigureMockMvc
class AdminCafeteriaIntegrationTest extends JwtTestSupport {

    static final UUID CENTRAL = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final UUID NORTE = UUID.fromString("55555555-5555-4555-8555-555555555555");
    static final String PASSWORD = "ClaveSegura2026";

    @DynamicPropertySource
    static void privateKey(DynamicPropertyRegistry registry) {
        registry.add("JWT_PRIVATE_KEY_LOCATION", () -> PRIVATE_KEY_LOCATION);
    }

    @Autowired MockMvc mvc;
    @Autowired UsuarioRepository usuarios;
    @Autowired AsignacionCafeteriaRepository asignaciones;
    @Autowired JwtTokenService jwtTokenService;
    @Autowired LoginService loginService;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean RabbitTemplate rabbitTemplate;
    @MockitoBean CatalogoCafeterias catalogo;
    @MockitoBean ComprasEnCurso comprasEnCurso;

    String prefijo;
    Usuario admin;
    Usuario cajero;
    Usuario cajeroNorte;
    Usuario otroAdmin;

    @BeforeEach
    void setUp() {
        reset(rabbitTemplate, catalogo);
        when(catalogo.consultar(CENTRAL)).thenReturn(Optional.of(new CatalogoCafeterias.Cafeteria(CENTRAL, true)));
        when(catalogo.consultar(NORTE)).thenReturn(Optional.of(new CatalogoCafeterias.Cafeteria(NORTE, true)));
        prefijo = "c" + UUID.randomUUID().toString().substring(0, 8);
        admin = cuenta(Rol.ADMIN_CAFETERIA, CENTRAL, "a");
        cajero = cuenta(Rol.CAJERO, CENTRAL, "b");
        otroAdmin = cuenta(Rol.ADMIN_CAFETERIA, CENTRAL, "c");
        cajeroNorte = cuenta(Rol.CAJERO, NORTE, "d");
        cuenta(Rol.CLIENTE, null, "e");
    }

    // ------------------------------------------------------------------ listado y consulta

    @Test
    void listsOnlyTheCashiersOfItsOwnCafeteria() throws Exception {
        listar(admin, "q=" + prefijo).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].usuarioId").value(cajero.getId().toString()))
                .andExpect(jsonPath("$.content[0].cafeteriaId").value(CENTRAL.toString()));
        listar(admin, "q=" + prefijo + "&cafeteriaId=" + CENTRAL).andExpect(jsonPath("$.totalElements").value(1));
        // Otro rol no está a su alcance: página vacía, sin revelar si existen.
        listar(admin, "q=" + prefijo + "&rol=ADMIN_CAFETERIA").andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0)).andExpect(jsonPath("$.empty").value(true));
        listar(admin, "q=" + prefijo + "&cafeteriaId=" + NORTE).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ASIGNACION_NO_AUTORIZADA"));
    }

    @Test
    void accountsOutsideItsScopeAreNotFound() throws Exception {
        ver(admin, cajero).andExpect(status().isOk()).andExpect(jsonPath("$.rol").value("CAJERO"));
        for (Usuario ajeno : List.of(cajeroNorte, otroAdmin, admin)) {
            ver(admin, ajeno).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("USUARIO_NO_ENCONTRADO"));
            editar(admin, ajeno, "{\"telefono\":\"+56900000000\",\"version\":1}").andExpect(status().isNotFound());
        }
        for (Usuario ajeno : List.of(cajeroNorte, otroAdmin)) {
            transicion(admin, ajeno, "desactivar").andExpect(status().isNotFound());
            transicion(admin, ajeno, "baja").andExpect(status().isNotFound());
        }
        // Tampoco sobre su propia cuenta.
        transicion(admin, admin, "desactivar").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("OPERACION_SOBRE_SI_MISMO"));
        assertThat(recargar(cajeroNorte).isActivo()).isTrue();
        assertThat(recargar(otroAdmin).isEliminado()).isFalse();
    }

    // ------------------------------------------------------------------ alta

    @Test
    void invitesCashiersOnlyToItsOwnCafeteria() throws Exception {
        String email = prefijo + "nuevo@uct.cl";
        crear(admin, UUID.randomUUID(), alta(email, "CAJERO", null)).andExpect(status().isCreated())
                .andExpect(jsonPath("$.cafeteriaId").value(CENTRAL.toString()))
                .andExpect(jsonPath("$.estado").value("pendiente_activacion"));
        crear(admin, UUID.randomUUID(), alta(prefijo + "explicito@uct.cl", "CAJERO", CENTRAL))
                .andExpect(status().isCreated());

        crear(admin, UUID.randomUUID(), alta(prefijo + "norte@uct.cl", "CAJERO", NORTE))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ASIGNACION_NO_AUTORIZADA"));
        crear(admin, UUID.randomUUID(), alta(prefijo + "admin@uct.cl", "ADMIN_CAFETERIA", null))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
        crear(admin, UUID.randomUUID(), alta(cajeroNorte.getEmail(), "CAJERO", null))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EMAIL_YA_REGISTRADO"));
        assertThat(usuarios.findByEmailIgnoreCase(prefijo + "norte@uct.cl")).isEmpty();
        assertThat(usuarios.findByEmailIgnoreCase(prefijo + "admin@uct.cl")).isEmpty();
    }

    @Test
    void retryingTheSameInvitationCreatesOneAccount() throws Exception {
        UUID clave = UUID.randomUUID();
        String email = prefijo + "reintento@uct.cl";
        crear(admin, clave, alta(email, "CAJERO", null)).andExpect(status().isCreated());
        // Omitir la cafetería o enviar la propia es la misma solicitud.
        crear(admin, clave, alta(email, "CAJERO", CENTRAL)).andExpect(status().isCreated())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                        .header().string("Idempotency-Replayed", "true"));
        verify(rabbitTemplate, times(1)).convertAndSend(anyString(),
                eq(AuthEventPublisher.INVITACION_PERSONAL_EVENT), any(Object.class));
    }

    @Test
    void theCafeteriaComesFromAuthNotFromTheJwtClaim() throws Exception {
        // Un JWT válido con un claim cafeteriaId desactualizado o alterado no amplía el alcance.
        String alterado = "Bearer " + sign(claims().subject(admin.getId().toString()).claim("role", "ADMIN_CAFETERIA")
                .claim("cafeteriaId", NORTE.toString()).build(), KEYS, JWSAlgorithm.RS256);
        mvc.perform(post("/auth/admin/personal").header("Authorization", alterado)
                        .header("Idempotency-Key", UUID.randomUUID().toString()).contentType(MediaType.APPLICATION_JSON)
                        .content(alta(prefijo + "claim@uct.cl", "CAJERO", null)))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.cafeteriaId").value(CENTRAL.toString()));
        mvc.perform(get("/auth/admin/usuarios/" + cajeroNorte.getId()).header("Authorization", alterado))
                .andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ ediciones y transiciones

    @Test
    void editsAndDeactivatesItsCashiersRevokingSessions() throws Exception {
        String refresh = loginService.iniciarSesion(cajero.getEmail(), PASSWORD).refreshToken();

        editar(admin, cajero, "{\"telefono\":\"+56987654321\",\"version\":1}").andExpect(status().isOk())
                .andExpect(jsonPath("$.telefono").value("+56987654321"));
        transicion(admin, cajero, "desactivar").andExpect(status().isOk()).andExpect(jsonPath("$.estado").value("inactiva"));
        refrescar(refresh).andExpect(status().isUnauthorized());
        asignacionInterna(cajero).andExpect(status().isNotFound());

        transicion(admin, cajero, "reactivar").andExpect(status().isOk()).andExpect(jsonPath("$.estado").value("activa"));
        asignacionInterna(cajero).andExpect(status().isOk());
    }

    @Test
    void removesItsCashiersAndCannotReassignStaff() throws Exception {
        asignar(admin, cajero, NORTE).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
        assertThat(asignaciones.findById(cajero.getId())).map(AsignacionCafeteria::getCafeteriaId).contains(CENTRAL);

        transicion(admin, cajero, "baja").andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("eliminado+" + cajero.getId() + "@anonimo.invalid"));
        assertThat(recargar(cajero).isEliminado()).isTrue();
        // La cuenta ya no pertenece a su cafetería.
        transicion(admin, cajero, "baja").andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ actor sin alcance

    @Test
    void anAdministratorWithoutAssignmentOrDeactivatedCannotAdminister() throws Exception {
        String token = jwt(admin);
        asignaciones.deleteById(admin.getId());
        listar(token, "q=" + prefijo).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ASIGNACION_NO_AUTORIZADA"));

        asignaciones.saveAndFlush(new AsignacionCafeteria(admin.getId(), CENTRAL));
        listar(token, "q=" + prefijo).andExpect(status().isOk());

        Usuario recargado = recargar(admin);
        recargado.desactivar();
        usuarios.saveAndFlush(recargado);
        listar(token, "q=" + prefijo).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ROL_NO_PERMITIDO"));
    }

    @Test
    void aReassignmentChangesItsScopeOnTheNextRequest() throws Exception {
        String token = jwt(admin);
        asignaciones.findById(admin.getId()).ifPresent(a -> {
            a.reasignar(NORTE);
            asignaciones.saveAndFlush(a);
        });
        listar(token, "q=" + prefijo).andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].usuarioId").value(cajeroNorte.getId().toString()));
        ver(token, cajero).andExpect(status().isNotFound());
    }

    // ------------------------------------------------------------------ auditoría

    @Test
    void everyChangeIsAttributedToTheAdministratorWhoMadeIt() throws Exception {
        String email = prefijo + "auditado@uct.cl";
        crear(admin, UUID.randomUUID(), alta(email, "CAJERO", null)).andExpect(status().isCreated());
        UUID nuevo = usuarios.findByEmailIgnoreCase(email).orElseThrow().getId();
        editar(admin, cajero, "{\"nombre\":\"Carla\",\"version\":1}").andExpect(status().isOk());
        transicion(admin, cajero, "desactivar").andExpect(status().isOk());
        transicion(admin, cajero, "desactivar").andExpect(status().isOk()); // sin cambios: no se audita
        transicion(admin, cajero, "baja").andExpect(status().isOk());

        assertThat(auditoria(admin)).containsExactly(
                Map.of("accion", "INVITAR", "usuario", nuevo.toString(), "rol", "ADMIN_CAFETERIA"),
                Map.of("accion", "EDITAR", "usuario", cajero.getId().toString(), "rol", "ADMIN_CAFETERIA"),
                Map.of("accion", "DESACTIVAR", "usuario", cajero.getId().toString(), "rol", "ADMIN_CAFETERIA"),
                Map.of("accion", "DAR_DE_BAJA", "usuario", cajero.getId().toString(), "rol", "ADMIN_CAFETERIA"));
        assertThat(jdbc.queryForObject(
                "SELECT cafeteria_id FROM auditoria_cuentas WHERE actor_id = ? AND accion = 'INVITAR'",
                UUID.class, admin.getId())).isEqualTo(CENTRAL);

        // Los rechazos no dejan registro.
        transicion(admin, cajeroNorte, "desactivar").andExpect(status().isNotFound());
        assertThat(auditoria(admin)).hasSize(4);
    }

    // ------------------------------------------------------------------ apoyo

    private Usuario cuenta(Rol rol, UUID cafeteria, String sufijo) {
        Usuario usuario = new Usuario(prefijo + sufijo + "-" + UUID.randomUUID() + "@uct.cl",
                passwordEncoder.encode(PASSWORD), rol, "Ana", "Pérez", "+56912345678");
        usuario.verificar();
        usuario = usuarios.saveAndFlush(usuario);
        if (cafeteria != null) asignaciones.saveAndFlush(new AsignacionCafeteria(usuario.getId(), cafeteria));
        return usuario;
    }

    private Usuario recargar(Usuario usuario) {
        return usuarios.findById(usuario.getId()).orElseThrow();
    }

    private String jwt(Usuario usuario) {
        return "Bearer " + jwtTokenService.emitir(usuario);
    }

    private List<Map<String, String>> auditoria(Usuario actor) {
        return jdbc.queryForList("""
                SELECT accion, usuario_id, actor_rol FROM auditoria_cuentas WHERE actor_id = ?
                ORDER BY created_at, accion
                """, actor.getId()).stream()
                .map(fila -> Map.of("accion", (String) fila.get("accion"),
                        "usuario", fila.get("usuario_id").toString(), "rol", (String) fila.get("actor_rol")))
                .toList();
    }

    private static String alta(String email, String rol, UUID cafeteria) {
        return "{\"email\":\"" + email + "\",\"nombre\":\"Ana\",\"apellido\":\"Pérez\",\"telefono\":\"+56912345678\","
                + "\"rol\":\"" + rol + "\"" + (cafeteria == null ? "" : ",\"cafeteriaId\":\"" + cafeteria + "\"") + "}";
    }

    private ResultActions crear(Usuario actor, UUID clave, String cuerpo) throws Exception {
        return mvc.perform(post("/auth/admin/personal").header("Authorization", jwt(actor))
                .header("Idempotency-Key", clave.toString()).contentType(MediaType.APPLICATION_JSON).content(cuerpo));
    }

    private ResultActions listar(Usuario actor, String query) throws Exception {
        return listar(jwt(actor), query);
    }

    private ResultActions listar(String token, String query) throws Exception {
        return mvc.perform(get("/auth/admin/usuarios?" + query).header("Authorization", token));
    }

    private ResultActions ver(Usuario actor, Usuario usuario) throws Exception {
        return ver(jwt(actor), usuario);
    }

    private ResultActions ver(String token, Usuario usuario) throws Exception {
        return mvc.perform(get("/auth/admin/usuarios/" + usuario.getId()).header("Authorization", token));
    }

    private ResultActions editar(Usuario actor, Usuario usuario, String cuerpo) throws Exception {
        return mvc.perform(patch("/auth/admin/usuarios/" + usuario.getId()).header("Authorization", jwt(actor))
                .contentType(MediaType.APPLICATION_JSON).content(cuerpo));
    }

    private ResultActions asignar(Usuario actor, Usuario usuario, UUID cafeteria) throws Exception {
        return mvc.perform(put("/auth/admin/usuarios/" + usuario.getId() + "/asignacion")
                .header("Authorization", jwt(actor)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"cafeteriaId\":\"" + cafeteria + "\",\"version\":1}"));
    }

    private ResultActions transicion(Usuario actor, Usuario usuario, String accion) throws Exception {
        return mvc.perform(post("/auth/admin/usuarios/" + usuario.getId() + "/" + accion)
                .header("Authorization", jwt(actor)));
    }

    private ResultActions refrescar(String refresh) throws Exception {
        return mvc.perform(post("/auth/refresh").contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"" + refresh + "\"}"));
    }

    private ResultActions asignacionInterna(Usuario usuario) throws Exception {
        return mvc.perform(get("/internal/servicios/asignaciones/" + usuario.getId())
                .header("X-Internal-Service-Token", INTERNAL_TOKEN));
    }
}
