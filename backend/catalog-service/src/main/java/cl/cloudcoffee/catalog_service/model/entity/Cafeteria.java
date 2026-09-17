package cl.cloudcoffee.catalog_service.model.entity;

import cl.cloudcoffee.catalog_service.model.enums.CafeteriaStatus;
import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "cafeteria")
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
}
