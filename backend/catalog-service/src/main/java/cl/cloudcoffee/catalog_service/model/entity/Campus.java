package cl.cloudcoffee.catalog_service.model.entity;

import jakarta.persistence.*;
import java.util.UUID;
import java.time.Instant;
import java.util.List;
import lombok.Getter; import lombok.Setter;

@Entity
@Table(name = "campus")
@Getter
@Setter
public class Campus {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private String name;
    private String location;
    @Column(nullable = false)
    private boolean active = true;
    private Instant bajaAt;
    @Version
    @Column(nullable = false)
    private Long version;

    @OneToMany(mappedBy = "campus", cascade = CascadeType.ALL)
    private List<Cafeteria> cafeterias;
}
