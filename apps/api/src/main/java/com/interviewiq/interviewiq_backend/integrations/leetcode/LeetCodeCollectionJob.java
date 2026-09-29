package com.interviewiq.interviewiq_backend.integrations.leetcode;

import com.interviewiq.interviewiq_backend.models.LeetCodeConnection;
import com.interviewiq.interviewiq_backend.models.SyncStatus;
import com.interviewiq.interviewiq_backend.repositories.LeetCodeConnectionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.UUID;

/**
 * Runs LeetCode collection off the request thread. Connect returns immediately and this worker
 * fetches + normalizes in the background; the frontend polls the connection status to learn when
 * the fragment is ready. Also reused synchronously by the weekly refresh scheduler.
 */
@Component
public class LeetCodeCollectionJob {

    private static final Logger log = LoggerFactory.getLogger(LeetCodeCollectionJob.class);

    private final LeetCodeConnectionRepository connectionRepository;
    private final LeetCodeCollector collector;

    public LeetCodeCollectionJob(
            LeetCodeConnectionRepository connectionRepository,
            LeetCodeCollector collector) {
        this.connectionRepository = connectionRepository;
        this.collector = collector;
    }

    /** Background entry point used right after a successful connect. Never throws to the caller. */
    @Async
    public void runAsync(UUID connectionId) {
        connectionRepository.findById(connectionId).ifPresentOrElse(
                this::refresh,
                () -> log.warn("LeetCode collection skipped: connection {} no longer exists", connectionId));
    }

    /**
     * Fetch + normalize + upsert for one connection, then record the outcome on the connection:
     * <ul>
     *   <li>success  -&gt; SYNCED + lastRefreshedAt bumped</li>
     *   <li>null user -&gt; DEGRADED, fragment left as last-known-good (not deleted)</li>
     *   <li>any error -&gt; FAILED, fragment untouched</li>
     * </ul>
     * Synchronous and self-contained so the weekly scheduler can call it directly per connection.
     */
    public void refresh(LeetCodeConnection connection) {
        try {
            LeetCodeCollector.CollectResult result = collector.collectAndStore(connection);
            if (result == LeetCodeCollector.CollectResult.NULL_USER) {
                connection.setStatus(SyncStatus.DEGRADED);
                log.warn("LeetCode profile '{}' returned null (private/removed); keeping last-known-good data",
                        connection.getUsername());
            } else {
                connection.setStatus(SyncStatus.SYNCED);
                connection.setLastRefreshedAt(Instant.now());
            }
        } catch (LeetCodeProfileException ex) {
            connection.setStatus(SyncStatus.FAILED);
            log.warn("LeetCode collection failed for '{}' ({}): {}",
                    connection.getUsername(), ex.getCode(), ex.getMessage());
        } catch (RuntimeException ex) {
            connection.setStatus(SyncStatus.FAILED);
            log.warn("LeetCode collection failed unexpectedly for '{}': {}",
                    connection.getUsername(), ex.getMessage());
        } finally {
            connectionRepository.save(connection);
        }
    }
}
