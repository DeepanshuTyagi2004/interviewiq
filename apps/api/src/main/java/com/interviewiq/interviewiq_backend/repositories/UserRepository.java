package com.interviewiq.interviewiq_backend.repositories;

import com.interviewiq.interviewiq_backend.models.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByGoogleSub(String googleSub);
}
