package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A company students can target. {@code slug} (lowercase) is the join key to
 * {@link CompanyRoleConfig#getCompany()} and to the AI-service brief keys.
 */
@Entity
@Table(name = "companies")
@Getter
@Setter
@NoArgsConstructor
public class Company {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String slug;

    /** Tier 1-5 (campus-placement tiering); descriptive metadata only, not a ranking of candidates. */
    @Column(name = "tier")
    private Integer tier;

    @Column(name = "logo_url")
    private String logoUrl;

    @Column(name = "headquarter_location")
    private String headquarterLocation;

    @Column(name = "company_size")
    private String companySize;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public Company(String name, String slug, Integer tier, String logoUrl,
                   String headquarterLocation, String companySize) {
        this.name = name;
        this.slug = slug;
        this.tier = tier;
        this.logoUrl = logoUrl;
        this.headquarterLocation = headquarterLocation;
        this.companySize = companySize;
    }

    @PrePersist
    void onCreate() {
        if (this.createdAt == null) {
            this.createdAt = Instant.now();
        }
    }
}
