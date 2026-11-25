package cl.cloudcoffee.catalog_service.model.entity;

import jakarta.persistence.*;
import java.util.UUID;
import java.util.List;
import java.util.Locale;
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

    @Column(name = "name_key", length = 100)
    private String nameKey;

    @Column(nullable = false)
    private boolean active = true;

    @Version
    @Column(nullable = false)
    private Long version;

    @OneToMany(mappedBy = "category")
    private List<Product> products;

    @PrePersist
    @PreUpdate
    private void updateNameKey() {
        nameKey = name == null ? null : name.toLowerCase(Locale.ROOT);
    }
}
