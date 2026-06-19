package com.interviewiq.interviewiq_backend.jobs;

import com.interviewiq.interviewiq_backend.integrations.leetcode.LeetCodeCollectionJob;
import com.interviewiq.interviewiq_backend.models.LeetCodeConnection;
import com.interviewiq.interviewiq_backend.repositories.LeetCodeConnectionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Weekly background refresh trigger point for LeetCode connections (mirrors the GitHub scheduler).
 * The scheduler is the same simple {@code @Scheduled} cron the rest of the project uses; the actual
 * fetch + status bookkeeping lives in {@link LeetCodeCollectionJob#refresh}.
 */
@Component
public class LeetCodeRefreshScheduler {

    private static final Logger log = LoggerFactory.getLogger(LeetCodeRefreshScheduler.class);

    private final LeetCodeConnectionRepository connectionRepository;
    private final LeetCodeCollectionJob collectionJob;

    public LeetCodeRefreshScheduler(
            LeetCodeConnectionRepository connectionRepository,
            LeetCodeCollectionJob collectionJob) {
        this.connectionRepository = connectionRepository;
        this.collectionJob = collectionJob;
    }

    /** Weekly refresh of every LeetCode connection. fixedRate = 7 days; offset from the GitHub job. */
    @Scheduled(fixedRate = 7L * 24 * 60 * 60 * 1000, initialDelay = 120_000)
    public void refreshAllLeetCodeConnections() {
        List<LeetCodeConnection> connections = connectionRepository.findAll();
        log.info("Weekly LeetCode refresh starting for {} connection(s)", connections.size());
        for (LeetCodeConnection connection : connections) {
            try {
                // refresh() records its own success/degraded/failed status and never throws.
                collectionJob.refresh(connection);
            } catch (RuntimeException ex) {
                log.warn("LeetCode refresh failed for username={}: {}",
                        connection.getUsername(), ex.getMessage());
            }
        }
        log.info("Weekly LeetCode refresh complete");
    }
}
