package com.interviewiq.interviewiq_backend.models;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;

class InterviewSessionLiveFieldsTest {

    @Test
    void liveStatesExist() {
        assertEquals("LIVE_IN_PROGRESS", SessionStatus.LIVE_IN_PROGRESS.name());
        assertEquals("COMPLETED", SessionStatus.COMPLETED.name());
        assertEquals("ABORTED_TECHNICAL", SessionStatus.ABORTED_TECHNICAL.name());
    }

    @Test
    void liveAndOutcomeFieldsRoundTrip() {
        InterviewSession s = new InterviewSession();
        Instant now = Instant.now();
        s.setStatus(SessionStatus.LIVE_IN_PROGRESS);
        s.setLiveStartedAt(now);
        s.setLiveEndedAt(now);
        s.setEndedReason("natural_complete");
        s.setLivekitRoom("interview-abc");
        s.setLiveScoreFinal(0.72);
        s.setDurationS(1830);
        s.setOutcome("{\"session_id\":\"abc\"}");

        assertEquals(SessionStatus.LIVE_IN_PROGRESS, s.getStatus());
        assertEquals(now, s.getLiveStartedAt());
        assertEquals(now, s.getLiveEndedAt());
        assertEquals("natural_complete", s.getEndedReason());
        assertEquals("interview-abc", s.getLivekitRoom());
        assertEquals(0.72, s.getLiveScoreFinal());
        assertEquals(1830, s.getDurationS());
        assertEquals("{\"session_id\":\"abc\"}", s.getOutcome());
    }
}
