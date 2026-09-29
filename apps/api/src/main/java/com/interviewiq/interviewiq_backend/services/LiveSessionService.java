package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.LiveSessionResponse;
import com.interviewiq.interviewiq_backend.integrations.livekit.LiveKitTokenService;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Go-live + resume for a booked interview session (sub-project A, live-interview runtime). Minting
 * a token never mutates state on resume — only the {@code PREP_READY -> LIVE_IN_PROGRESS} transition
 * writes.
 */
@Service
public class LiveSessionService {

    private final InterviewSessionRepository sessionRepository;
    private final LiveKitTokenService liveKit;

    public LiveSessionService(
            InterviewSessionRepository sessionRepository,
            LiveKitTokenService liveKit) {
        this.sessionRepository = sessionRepository;
        this.liveKit = liveKit;
    }

    private InterviewSession requireOwned(UUID candidateId, UUID sessionId) {
        return sessionRepository.findByIdAndCandidateId(sessionId, candidateId)
                .orElseThrow(InterviewSessionException::notFound);
    }

    private LiveSessionResponse connection(UUID sessionId, UUID candidateId, SessionStatus status) {
        return new LiveSessionResponse(
                liveKit.livekitUrl(),
                liveKit.mintCandidateToken(sessionId, candidateId),
                liveKit.roomName(sessionId),
                status);
    }

    @Transactional
    public LiveSessionResponse startLive(UUID candidateId, UUID sessionId) {
        InterviewSession s = requireOwned(candidateId, sessionId);
        if (s.getStatus() == SessionStatus.LIVE_IN_PROGRESS) {
            return connection(sessionId, candidateId, s.getStatus()); // resume: fresh token, no state change
        }
        if (s.getStatus() != SessionStatus.PREP_READY) {
            throw InterviewSessionException.conflict(
                    "session_not_ready", "session must be PREP_READY to go live");
        }
        s.setStatus(SessionStatus.LIVE_IN_PROGRESS);
        s.setLiveStartedAt(Instant.now());
        s.setLivekitRoom(liveKit.roomName(sessionId));
        sessionRepository.save(s);
        return connection(sessionId, candidateId, s.getStatus());
    }

    @Transactional(readOnly = true)
    public LiveSessionResponse getLive(UUID candidateId, UUID sessionId) {
        InterviewSession s = requireOwned(candidateId, sessionId);
        if (s.getStatus() == SessionStatus.LIVE_IN_PROGRESS) {
            return connection(sessionId, candidateId, s.getStatus());
        }
        return new LiveSessionResponse(null, null, null, s.getStatus());
    }

    /**
     * Called by the Python worker (internal, no owner scope) when an interview ends: persists the
     * full {@code SessionOutcome} JSON verbatim into the jsonb {@code outcome} column, promotes a
     * few scalars for querying, and flips the session to its terminal status.
     *
     * <p>The worker delivers outcomes at-least-once, so this is idempotent: if the session is
     * already terminal ({@code COMPLETED} or {@code ABORTED_TECHNICAL}), a retried delivery is a
     * safe no-op rather than an error or a re-write.
     */
    @Transactional
    public void recordOutcome(UUID sessionId, tools.jackson.databind.JsonNode outcome) {
        InterviewSession s = sessionRepository.findById(sessionId)
                .orElseThrow(InterviewSessionException::notFound);
        if (s.getStatus() == SessionStatus.COMPLETED || s.getStatus() == SessionStatus.ABORTED_TECHNICAL) {
            return; // already finalized: duplicate delivery, idempotent no-op
        }
        String endedReason = outcome.path("ended_reason").asString(null);
        s.setEndedReason(endedReason);
        if (outcome.has("live_score_final") && !outcome.path("live_score_final").isNull()) {
            s.setLiveScoreFinal(outcome.path("live_score_final").asDouble());
        }
        if (outcome.has("duration_s") && !outcome.path("duration_s").isNull()) {
            s.setDurationS((int) Math.round(outcome.path("duration_s").asDouble()));
        }
        s.setOutcome(outcome.toString());
        s.setLiveEndedAt(Instant.now());
        s.setStatus("aborted_technical".equals(endedReason)
                ? SessionStatus.ABORTED_TECHNICAL : SessionStatus.COMPLETED);
        sessionRepository.save(s);
    }
}
