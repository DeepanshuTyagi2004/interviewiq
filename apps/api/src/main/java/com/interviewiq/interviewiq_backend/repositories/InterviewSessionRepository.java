package com.interviewiq.interviewiq_backend.repositories;

import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface InterviewSessionRepository extends JpaRepository<InterviewSession, UUID> {

    /** A candidate's sessions, newest slot first (for the dashboard list). */
    List<InterviewSession> findAllByCandidateIdOrderByScheduledAtDesc(UUID candidateId);

    /** One session, scoped to its owner — the ownership check for read/regenerate. */
    Optional<InterviewSession> findByIdAndCandidateId(UUID id, UUID candidateId);

    /** Sessions in a given status whose slot is at or before the cutoff — the poller's due-set. */
    List<InterviewSession> findByStatusAndScheduledAtLessThanEqual(SessionStatus status, Instant cutoff);
}
