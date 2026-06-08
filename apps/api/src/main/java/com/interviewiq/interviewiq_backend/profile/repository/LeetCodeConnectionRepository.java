package com.interviewiq.interviewiq_backend.profile.repository;

import com.interviewiq.interviewiq_backend.profile.model.LeetCodeConnection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface LeetCodeConnectionRepository extends JpaRepository<LeetCodeConnection, UUID> {
    Optional<LeetCodeConnection> findByUserId(UUID userId);

    @Transactional
    void deleteByUserId(UUID userId);
}
