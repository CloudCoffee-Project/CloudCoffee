package cl.cloudcoffee.catalog_service.model.entity;

import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import jakarta.persistence.*;
import java.util.UUID;
import java.time.Instant;
import lombok.Getter; import lombok.Setter;

@Entity
@Table(name = "cafeteria")
@Getter
@Setter
public class Cafeteria {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "campus_id", nullable = false)
    private Campus campus;

    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private CafeteriaStatus status;
    @Column(nullable = false)
    private boolean active = true;
    private Instant bajaAt;
    @Version
    @Column(nullable = false)
    private Long version;
}
