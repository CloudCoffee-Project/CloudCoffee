package cl.cloudcoffee.errors.security;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import tools.jackson.databind.json.JsonMapper;

@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(name = "org.springframework.security.web.AuthenticationEntryPoint")
public class ApiSecurityErrorsAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    ApiSecurityErrorHandler apiSecurityErrorHandler(JsonMapper mapper) {
        return new ApiSecurityErrorHandler(mapper);
    }

    @Bean
    @ConditionalOnMissingBean
    ApiSecurityExceptionHandler apiSecurityExceptionHandler() {
        return new ApiSecurityExceptionHandler();
    }
}
