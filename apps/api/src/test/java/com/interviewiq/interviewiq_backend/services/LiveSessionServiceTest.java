package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.LiveSessionResponse;
import com.interviewiq.interviewiq_backend.integrations.livekit.LiveKitTokenService;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class LiveSessionServiceTest {

    private static final UUID USER = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Mock InterviewSessionRepository sessionRepository;
    @Mock LiveKitTokenService liveKit;
    @InjectMocks LiveSessionService service;

    private InterviewSession session(SessionStatus status) {
        InterviewSession s = new InterviewSession();
        s.setCandidateId(USER);
        s.setStatus(status);
        return s;
    }

    @Test
    void startLive_fromPrepReady_mintsTokenFlipsToLiveAndReturnsConnection() {
        InterviewSession s = session(SessionStatus.PREP_READY);
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(s));
        when(sessionRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(liveKit.roomName(sid)).thenReturn("interview-" + sid);
        when(liveKit.mintCandidateToken(sid, USER)).thenReturn("jwt-token");
        when(liveKit.livekitUrl()).thenReturn("wss://x.livekit.cloud");

        LiveSessionResponse resp = service.startLive(USER, sid);

        assertEquals("wss://x.livekit.cloud", resp.livekitUrl());
        assertEquals("jwt-token", resp.token());
        assertEquals("interview-" + sid, resp.roomName());
        assertEquals(SessionStatus.LIVE_IN_PROGRESS, resp.status());
        assertEquals(SessionStatus.LIVE_IN_PROGRESS, s.getStatus());
        assertNotNull(s.getLiveStartedAt());
        assertEquals("interview-" + sid, s.getLivekitRoom());
    }

    @Test
    void startLive_whenAlreadyLive_returnsFreshTokenWithoutChangingStartedAt() {
        InterviewSession s = session(SessionStatus.LIVE_IN_PROGRESS);
        java.time.Instant started = java.time.Instant.parse("2020-01-01T00:00:00Z");
        s.setLiveStartedAt(started);
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(s));
        when(liveKit.roomName(sid)).thenReturn("interview-" + sid);
        when(liveKit.mintCandidateToken(sid, USER)).thenReturn("jwt-2");
        when(liveKit.livekitUrl()).thenReturn("wss://x.livekit.cloud");

        LiveSessionResponse resp = service.startLive(USER, sid);

        assertEquals("jwt-2", resp.token());
        assertEquals(started, s.getLiveStartedAt(), "must not reset liveStartedAt on resume");
        verify(sessionRepository, never()).save(any());
    }

    @Test
    void startLive_whenNotReady_throwsConflict() {
        InterviewSession s = session(SessionStatus.SCHEDULED);
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(s));

        InterviewSessionException ex =
                assertThrows(InterviewSessionException.class, () -> service.startLive(USER, sid));
        assertEquals(409, ex.status().value());
    }

    @Test
    void startLive_whenNotOwned_throwsNotFound() {
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.empty());

        InterviewSessionException ex =
                assertThrows(InterviewSessionException.class, () -> service.startLive(USER, sid));
        assertEquals(404, ex.status().value());
    }

    @Test
    void getLive_whenLive_returnsToken_elseStatusOnly() {
        UUID sid = UUID.randomUUID();
        InterviewSession live = session(SessionStatus.LIVE_IN_PROGRESS);
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(live));
        when(liveKit.roomName(sid)).thenReturn("interview-" + sid);
        when(liveKit.mintCandidateToken(sid, USER)).thenReturn("jwt-3");
        when(liveKit.livekitUrl()).thenReturn("wss://x.livekit.cloud");

        LiveSessionResponse r1 = service.getLive(USER, sid);
        assertEquals("jwt-3", r1.token());
        assertEquals(SessionStatus.LIVE_IN_PROGRESS, r1.status());

        InterviewSession ready = session(SessionStatus.PREP_READY);
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(ready));
        LiveSessionResponse r2 = service.getLive(USER, sid);
        assertNull(r2.token());
        assertEquals(SessionStatus.PREP_READY, r2.status());
    }
}
