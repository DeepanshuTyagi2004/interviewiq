package com.interviewiq.interviewiq_backend.jobs;

import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import com.interviewiq.interviewiq_backend.services.InterviewPrepService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * The prep trigger. A configurable lead time before each session's slot, it picks up SCHEDULED
 * sessions due within that window and builds their prep plan (moving them PREP_QUEUED → PREP_READY,
 * or PREP_FAILED). Uses plain Spring {@code @Scheduled} — the repo's existing scheduling mechanism
 * (see {@code ProfileRefreshScheduler} / {@code LeetCodeRefreshScheduler}); no new queue dependency.
 *
 * <p>Poll cadence and lead time are configurable (see application.properties {@code interviewprep.*}).
 */
@Component
public class InterviewPrepScheduler {

    private static final Logger log = LoggerFactory.getLogger(InterviewPrepScheduler.class);

    private final InterviewSessionRepository sessionRepository;
    private final InterviewPrepService prepService;
    private final long leadTimeMinutes;

    public InterviewPrepScheduler(
            InterviewSessionRepository sessionRepository,
            InterviewPrepService prepService,
            @Value("${interviewprep.lead-time-minutes:15}") long leadTimeMinutes) {
        this.sessionRepository = sessionRepository;
        this.prepService = prepService;
        this.leadTimeMinutes = leadTimeMinutes;
    }

    /** Poll for sessions whose slot is within the lead-time window and prepare each. */
    @Scheduled(
            fixedDelayString = "${interviewprep.poll-interval-ms:60000}",
            initialDelayString = "${interviewprep.poll-initial-delay-ms:30000}")
    public void prepareDueSessions() {
        Instant cutoff = Instant.now().plus(Duration.ofMinutes(leadTimeMinutes));
        List<InterviewSession> due = sessionRepository
                .findByStatusAndScheduledAtLessThanEqual(SessionStatus.SCHEDULED, cutoff);
        if (due.isEmpty()) {
            return;
        }
        log.info("Interview prep: {} session(s) due within {}-min lead time", due.size(), leadTimeMinutes);
        for (InterviewSession session : due) {
            try {
                prepService.generatePrep(session.getId());
            } catch (RuntimeException ex) {
                // generatePrep records PREP_FAILED itself; keep the loop going for the rest.
                log.warn("Interview prep failed for session {}: {}", session.getId(), ex.getMessage());
            }
        }
        log.info("Interview prep poll complete");
    }
}
