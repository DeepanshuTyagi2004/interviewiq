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

    public LiveSessionService(InterviewSessionRepository sessionRepository, LiveKitTokenService liveKit) {
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
}
