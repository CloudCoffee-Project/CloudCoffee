package cl.cloudcoffee.catalog_service.messaging;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import cl.cloudcoffee.catalog_service.service.StockService;

@Component
public class PagoAprobadoConsumer {

    private final StockService stockService;

    public PagoAprobadoConsumer(StockService stockService) {
        this.stockService = stockService;
    }

    @RabbitListener(queues = RabbitTopologyConfig.CATALOG_EVENTS_QUEUE)
    public void consume(CloudCoffeeEvent event) {
        stockService.confirmarVenta(event);
    }
}
