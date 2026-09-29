package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * One company + role + level combination the scraping pipeline should collect for.
 * This table is the source of truth for what interviewiq-ai-service scrapes — the
 * AI service reads it over HTTP via the internal scrape-targets endpoint.
 *
 * <p>{@code level} is a free string holding one of the interview-experience levels
 * ({@code fresher}, {@code sde1}, {@code sde2}, {@code sde3}); kept as a String rather
 * than a JPA enum so the catalogue can evolve without a code change.
 */
@Entity
@Table(
        name = "company_role_configs",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_company_role_level",
                columnNames = {"company", "role", "level"}
        )
)
@Getter
@Setter
@NoArgsConstructor
public class CompanyRoleConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(nullable = false)
    private String company;

    @Column(nullable = false)
    private String role;

    @Column(nullable = false, length = 16)
    private String level;

    /** The real JD title this combination represents (e.g. "Software Engineer, Early Career"). */
    @Column(name = "jd_title")
    private String title;

    /** Optional link to the source job posting. */
    @Column(name = "jd_url")
    private String jdUrl;

    /** Full JD content/requirements. TEXT (not varchar) — JDs can be large; this is
     *  fed to Perplexity as context when searching for interview experiences. */
    @Column(name = "jd_description", columnDefinition = "text")
    private String jdDescription;

    /** Student-facing JD library fields (Module 3). */
    @Column(name = "requirements", columnDefinition = "text")
    private String requirements;

    @Column(name = "responsibilities", columnDefinition = "text")
    private String responsibilities;

    /** Comma-separated tech stack (exposed as a list in the API; stored as text, no child table). */
    @Column(name = "tech_stack", columnDefinition = "text")
    private String techStack;

    /** Typical number of interview rounds (seed value; the live breakdown comes from the brief). */
    @Column(name = "round_count")
    private Integer roundCount;

    /** Toggle a combination off without deleting it; only enabled rows are scraped. */
    @Column(nullable = false)
    private boolean enabled;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public CompanyRoleConfig(String company, String role, String level) {
        this(company, role, level, null, null);
    }

    public CompanyRoleConfig(String company, String role, String level, String title, String jdUrl) {
        this.company = company;
        this.role = role;
        this.level = level;
        this.title = title;
        this.jdUrl = jdUrl;
        this.enabled = true;
    }

    @PrePersist
    void onCreate() {
        if (this.createdAt == null) {
            this.createdAt = Instant.now();
        }
    }
}
