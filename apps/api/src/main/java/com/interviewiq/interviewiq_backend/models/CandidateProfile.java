package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Editable, user-owned candidate details captured during onboarding (personal info, education,
 * experience, skills) and shown/edited on the profile page.
 *
 * <p>This is deliberately SEPARATE from {@link ProfileFragment}: fragments are the descriptive,
 * hash-versioned inputs to Profile Builder synthesis (GitHub/LeetCode), whereas this is the
 * canonical thing the user types and owns. The repeating collections (education/experience/skills)
 * and the detected profile links are stored as Postgres {@code jsonb} strings — same pattern as
 * {@code ProfileFragment.data}; the Hikari {@code stringtype=unspecified} setting lets PG cast the
 * String param to jsonb. One row per user.
 */
@Entity
@Table(
        name = "candidate_profile",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_candidate_profile_user",
                columnNames = "user_id"
        )
)
@Getter
@Setter
@NoArgsConstructor
public class CandidateProfile {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false, unique = true)
    private UUID userId;

    @Column(name = "full_name")
    private String fullName;

    @Column
    private String email;

    @Column
    private String phone;

    @Column
    private String location;

    @Column
    private String headline;

    @Column(name = "target_role")
    private String targetRole;

    // jsonb (String-mapped, canonical JSON). Never null — default to an empty array/object so
    // reads never NPE and the column can stay NOT NULL.
    @Column(name = "education", nullable = false, columnDefinition = "jsonb")
    private String education = "[]";

    @Column(name = "experience", nullable = false, columnDefinition = "jsonb")
    private String experience = "[]";

    // projects/achievements were added after the table already had rows, so they carry a DB DEFAULT
    // '[]' — otherwise Hibernate's ddl-auto=update ALTER ... ADD COLUMN ... NOT NULL fails on a
    // populated table (existing rows would violate NOT NULL). The default backfills them.
    @Column(name = "projects", nullable = false, columnDefinition = "jsonb default '[]'::jsonb")
    private String projects = "[]";

    @Column(name = "skills", nullable = false, columnDefinition = "jsonb")
    private String skills = "[]";

    @Column(name = "achievements", nullable = false, columnDefinition = "jsonb default '[]'::jsonb")
    private String achievements = "[]";

    // {github, leetcode, linkedin} detected from the résumé — prefills the connectors step.
    @Column(name = "detected_links", nullable = false, columnDefinition = "jsonb")
    private String detectedLinks = "{}";

    @Column(name = "resume_filename")
    private String resumeFilename;

    @Column(name = "resume_parsed_at")
    private Instant resumeParsedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public CandidateProfile(UUID userId) {
        this.userId = userId;
    }

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = Instant.now();
    }
}
