package com.interviewiq.interviewiq_backend.repositories;

import com.interviewiq.interviewiq_backend.models.GitHubConnection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface GitHubConnectionRepository extends JpaRepository<GitHubConnection, UUID> {
    Optional<GitHubConnection> findByUserId(UUID userId);

    @Transactional
    void deleteByUserId(UUID userId);
}
