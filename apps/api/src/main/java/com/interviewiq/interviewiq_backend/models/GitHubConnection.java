package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "github_connection")
@Getter
@Setter
@NoArgsConstructor
public class GitHubConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "user_id", unique = true, nullable = false)
    private UUID userId;

    @Column(name = "github_login", nullable = false)
    private String githubLogin;

    // AES-256-GCM ciphertext (base64). NEVER logged, NEVER exposed in a DTO.
    @Column(name = "access_token_enc", nullable = false, length = 2048)
    private String accessTokenEnc;

    @Column(nullable = false)
    private String scope;

    @Column(name = "connected_at", nullable = false, updatable = false)
    private Instant connectedAt;

    @Column(name = "last_refreshed_at")
    private Instant lastRefreshedAt;

    public GitHubConnection(UUID userId, String githubLogin, String accessTokenEnc, String scope) {
        this.userId = userId;
        this.githubLogin = githubLogin;
        this.accessTokenEnc = accessTokenEnc;
        this.scope = scope;
    }

    @PrePersist
    void onCreate() {
        this.connectedAt = Instant.now();
    }
}
