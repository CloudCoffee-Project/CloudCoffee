package cl.cloudcoffee.catalog_service.model.entity;

import jakarta.persistence.*;
import java.util.UUID;
import java.util.List;

@Entity
@Table(name = "campus")
public class Campus {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private String name;
    private String location;

    @OneToMany(mappedBy = "campus", cascade = CascadeType.ALL)
    private List<Cafeteria> cafeterias;
}
