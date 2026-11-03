package cl.cloudcoffee.order_service.creacion;

import java.time.Clock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class CreacionConfiguration {
    @Bean
    @ConditionalOnMissingBean(Clock.class)
    Clock creationClock() { return Clock.systemUTC(); }
}
