package com.interviewiq.interviewiq_backend.profile.repository;

import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ProfileFragmentRepository extends JpaRepository<ProfileFragment, UUID> {
    List<ProfileFragment> findByUserId(UUID userId);

    Optional<ProfileFragment> findByUserIdAndSource(UUID userId, ProfileSource source);

    void deleteByUserIdAndSource(UUID userId, ProfileSource source);
}
