package com.interviewiq.interviewiq_backend.profile.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A user's LeetCode connection. Unlike GitHub there is no OAuth and no token —
 * LeetCode profiles are public and queried by username via the public GraphQL API.
 * We therefore store only the username plus the background-sync lifecycle status.
 */
@Entity
@Table(name = "leetcode_connection")
@Getter
@Setter
@NoArgsConstructor
public class LeetCodeConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "user_id", unique = true, nullable = false)
    private UUID userId;

    @Column(name = "username", nullable = false)
    private String username;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private SyncStatus status;

    @Column(name = "connected_at", nullable = false, updatable = false)
    private Instant connectedAt;

    @Column(name = "last_refreshed_at")
    private Instant lastRefreshedAt;

    public LeetCodeConnection(UUID userId, String username) {
        this.userId = userId;
        this.username = username;
        this.status = SyncStatus.SYNCING;
    }

    @PrePersist
    void onCreate() {
        if (this.connectedAt == null) {
            this.connectedAt = Instant.now();
        }
    }
}
