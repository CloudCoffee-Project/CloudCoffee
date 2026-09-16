package cl.cloudcoffee.auth_service.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "spring.rabbitmq.listener.simple.auto-startup=false")
@AutoConfigureMockMvc
class AuthControllerTest {

    @Autowired
    private MockMvc mvc;

    // Sin broker real disponible en el entorno de test; se reemplaza para no depender de infraestructura externa.
    @MockitoBean
    private RabbitTemplate rabbitTemplate;

    private static String registroJson(String email) {
        return """
                {
                  "email": "%s",
                  "password": "password123",
                  "nombre": "Ana",
                  "apellido": "Pérez",
                  "telefono": "+56912345678"
                }
                """.formatted(email);
    }

    @Test
    void registraUnClienteNuevo() throws Exception {
        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registroJson("nuevo-cliente@cloudcoffee.cl")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value("nuevo-cliente@cloudcoffee.cl"))
                .andExpect(jsonPath("$.rol").value("CLIENTE"))
                .andExpect(jsonPath("$.verificado").value(false))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.password").doesNotExist());
    }

    @Test
    void rechazaEmailDuplicado() throws Exception {
        String json = registroJson("duplicado@cloudcoffee.cl");

        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isCreated());

        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.detail").isNotEmpty());
    }

    @Test
    void rechazaDatosObligatoriosFaltantes() throws Exception {
        String requestInvalido = """
                {
                  "email": "no-es-un-correo",
                  "password": "123",
                  "nombre": "",
                  "apellido": "",
                  "telefono": ""
                }
                """;

        mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(requestInvalido))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.errors").isArray());
    }
}
