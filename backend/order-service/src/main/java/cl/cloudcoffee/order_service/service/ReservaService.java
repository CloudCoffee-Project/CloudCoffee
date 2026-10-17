package cl.cloudcoffee.order_service.service;

import java.time.Clock;
import java.time.Duration;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import cl.cloudcoffee.order_service.model.Compra;
import cl.cloudcoffee.order_service.model.Reserva;
import cl.cloudcoffee.order_service.repository.ReservaRepository;

/** Retiene stock para una compra durante la vigencia acordada (15 minutos por defecto). */
@Service
public class ReservaService {

    private final ReservaRepository reservaRepository;
    private final Clock clock;
    private final Duration vigencia;

    public ReservaService(ReservaRepository reservaRepository, Clock clock,
            @Value("${cloudcoffee.reservas.vigencia:PT15M}") Duration vigencia) {
        if (vigencia.isZero() || vigencia.isNegative()) {
            throw new IllegalArgumentException("cloudcoffee.reservas.vigencia debe ser positiva");
        }
        this.reservaRepository = reservaRepository;
        this.clock = clock;
        this.vigencia = vigencia;
    }

    @Transactional
    public Reserva reservar(Compra compra, UUID ofertaId, int cantidad) {
        return reservaRepository.save(new Reserva(compra, ofertaId, cantidad, clock.instant().plus(vigencia)));
    }

    public Duration getVigencia() {
        return vigencia;
    }
}
