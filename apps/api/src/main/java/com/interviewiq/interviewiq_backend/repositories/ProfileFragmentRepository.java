package com.interviewiq.interviewiq_backend.repositories;

import com.interviewiq.interviewiq_backend.models.ProfileFragment;
import com.interviewiq.interviewiq_backend.models.ProfileSource;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ProfileFragmentRepository extends JpaRepository<ProfileFragment, UUID> {
    List<ProfileFragment> findByUserId(UUID userId);

    Optional<ProfileFragment> findByUserIdAndSource(UUID userId, ProfileSource source);

    @Transactional
    void deleteByUserIdAndSource(UUID userId, ProfileSource source);
}
