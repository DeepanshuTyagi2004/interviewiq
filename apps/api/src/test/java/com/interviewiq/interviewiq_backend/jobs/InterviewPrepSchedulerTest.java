package com.interviewiq.interviewiq_backend.jobs;

import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.models.RoundType;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import com.interviewiq.interviewiq_backend.services.InterviewPrepService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class InterviewPrepSchedulerTest {

    @Mock InterviewSessionRepository sessionRepository;
    @Mock InterviewPrepService prepService;

    private InterviewPrepScheduler scheduler;

    @BeforeEach
    void setUp() {
        // Constructed manually — the lead-time is a primitive @Value, not a mock.
        scheduler = new InterviewPrepScheduler(sessionRepository, prepService, 15L);
    }

    private InterviewSession dueSession() {
        JobDescription jd = new JobDescription("google", "software-engineer", "sde1", "SWE",
                "backend", "d", "Java", "http://jd", "seed");
        jd.setId(UUID.randomUUID());
        InterviewSession s = new InterviewSession(UUID.randomUUID(), jd, RoundType.DSA,
                Instant.parse("2026-07-10T10:00:00Z"), "Asia/Kolkata");
        s.setId(UUID.randomUUID());
        return s;
    }

    @Test
    void prepareDueSessions_generatesPrepPerDueSession() {
        InterviewSession s1 = dueSession();
        InterviewSession s2 = dueSession();
        when(sessionRepository.findByStatusAndScheduledAtLessThanEqual(eq(SessionStatus.SCHEDULED), any()))
                .thenReturn(List.of(s1, s2));

        scheduler.prepareDueSessions();

        verify(prepService, times(1)).generatePrep(s1.getId());
        verify(prepService, times(1)).generatePrep(s2.getId());
        verifyNoMoreInteractions(prepService);
    }

    @Test
    @MockitoSettings(strictness = Strictness.LENIENT)
    void prepareDueSessions_oneFailure_continuesForRest() {
        InterviewSession s1 = dueSession();
        InterviewSession s2 = dueSession();
        InterviewSession s3 = dueSession();
        when(sessionRepository.findByStatusAndScheduledAtLessThanEqual(eq(SessionStatus.SCHEDULED), any()))
                .thenReturn(List.of(s1, s2, s3));
        doThrow(new RuntimeException("boom")).when(prepService).generatePrep(s2.getId());

        scheduler.prepareDueSessions();

        verify(prepService).generatePrep(s1.getId());
        verify(prepService).generatePrep(s2.getId());
        verify(prepService).generatePrep(s3.getId());
    }

    @Test
    void prepareDueSessions_noneDue_doesNothing() {
        when(sessionRepository.findByStatusAndScheduledAtLessThanEqual(eq(SessionStatus.SCHEDULED), any()))
                .thenReturn(List.of());

        scheduler.prepareDueSessions();

        verifyNoInteractions(prepService);
    }
}
