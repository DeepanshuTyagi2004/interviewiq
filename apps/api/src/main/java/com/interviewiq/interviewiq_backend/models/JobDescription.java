package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A specific job posting the student can browse and pick. MANY per company+level
 * (unlike {@link CompanyRoleConfig}, which is one brief-generation key per company+role+level).
 * The interview process for a JD comes from the brief keyed by (company, role, level).
 *
 * <p>{@code level} (fresher/sde1/sde2/sde3) is inferred from the posting title at ingest —
 * the library is shown experience-level-wise. {@code specialization} (backend/frontend/
 * fullstack/ml/mobile/general) is parsed from the title so users can filter/choose.
 */
@Entity
@Table(name = "job_descriptions", indexes = {
        @Index(name = "idx_jd_company_level", columnList = "company, level"),
})
@Getter
@Setter
@NoArgsConstructor
public class JobDescription {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(nullable = false)
    private String company;            // slug, joins to brief key + companies.slug

    @Column(nullable = false)
    private String role;               // normalized (software-engineer) — the brief key role

    @Column(nullable = false, length = 16)
    private String level;              // fresher/sde1/sde2/sde3 (inferred from title)

    @Column(nullable = false)
    private String title;

    @Column(length = 32)
    private String specialization;     // backend/frontend/fullstack/ml/mobile/platform/general

    @Column(columnDefinition = "text")
    private String description;

    @Column(name = "tech_stack", columnDefinition = "text")
    private String techStack;          // comma-separated

    @Column(name = "source_url")
    private String sourceUrl;

    /** "seed" (hand-seeded role-based JDs) — currently the only source. */
    @Column(nullable = false, length = 16)
    private String source;

    @Column(nullable = false)
    private boolean active;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public JobDescription(String company, String role, String level, String title,
                          String specialization, String description, String techStack,
                          String sourceUrl, String source) {
        this.company = company;
        this.role = role;
        this.level = level;
        this.title = title;
        this.specialization = specialization;
        this.description = description;
        this.techStack = techStack;
        this.sourceUrl = sourceUrl;
        this.source = source;
        this.active = true;
    }

    @PrePersist
    void onCreate() {
        if (this.createdAt == null) {
            this.createdAt = Instant.now();
        }
    }
}
