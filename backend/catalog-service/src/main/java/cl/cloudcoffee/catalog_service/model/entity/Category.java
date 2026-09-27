package cl.cloudcoffee.catalog_service.model.entity;

import jakarta.persistence.*;
import java.util.UUID;
import java.util.List;
import lombok.Getter; import lombok.Setter;

@Entity
@Table(name = "Category")
@Getter
@Setter
public class Category {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    private String name;
    private String description;

    @OneToMany(mappedBy = "category", cascade = CascadeType.ALL)
    private List<Product> products;
}
