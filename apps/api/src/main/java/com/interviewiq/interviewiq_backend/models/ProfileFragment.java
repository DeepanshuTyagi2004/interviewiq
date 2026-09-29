package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "profile_fragment",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_fragment_user_source",
                columnNames = {"user_id", "source"}
        )
)
@Getter
@Setter
@NoArgsConstructor
public class ProfileFragment {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ProfileSource source;

    // Canonical (key-sorted) JSON. Stored as Postgres jsonb; (de)serialized via ObjectMapper.
    @Column(name = "data", nullable = false, columnDefinition = "jsonb")
    private String data;

    @Column(name = "content_hash", nullable = false, length = 64)
    private String contentHash;

    @Column(nullable = false)
    private int version;

    @Column(name = "fetched_at", nullable = false)
    private Instant fetchedAt;

    public ProfileFragment(UUID userId, ProfileSource source, String data, String contentHash) {
        this.userId = userId;
        this.source = source;
        this.data = data;
        this.contentHash = contentHash;
        this.version = 1;
        this.fetchedAt = Instant.now();
    }
}
