package com.interviewiq.interviewiq_backend.integrations.leetcode;

import com.interviewiq.interviewiq_backend.models.LeetCodeConnection;
import com.interviewiq.interviewiq_backend.models.ProfileSource;
import com.interviewiq.interviewiq_backend.models.SyncStatus;
import com.interviewiq.interviewiq_backend.repositories.LeetCodeConnectionRepository;
import com.interviewiq.interviewiq_backend.repositories.ProfileFragmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Orchestrates the LeetCode connection lifecycle: validate the username synchronously (so a bad
 * username is rejected on the connect call), persist the connection, and kick off background
 * collection. Mirrors the GitHub flow but with a username instead of an OAuth token.
 */
@Service
public class LeetCodeService {

    // Pulls the handle out of inputs like "https://leetcode.com/u/aakash_42/" or "leetcode.com/aakash_42".
    private static final Pattern URL_HANDLE =
            Pattern.compile("(?:https?://)?(?:www\\.)?leetcode\\.com/(?:u/)?([^/?#\\s]+).*");

    private final LeetCodeConnectionRepository connectionRepository;
    private final ProfileFragmentRepository fragmentRepository;
    private final LeetCodeCollector collector;
    private final LeetCodeCollectionJob collectionJob;

    public LeetCodeService(
            LeetCodeConnectionRepository connectionRepository,
            ProfileFragmentRepository fragmentRepository,
            LeetCodeCollector collector,
            LeetCodeCollectionJob collectionJob) {
        this.connectionRepository = connectionRepository;
        this.fragmentRepository = fragmentRepository;
        this.collector = collector;
        this.collectionJob = collectionJob;
    }

    /**
     * Validate + persist the connection, then enqueue background collection. Returns immediately
     * with the connection in {@code SYNCING}. Throws {@link LeetCodeProfileException} when the
     * username is missing, not found, or private, and {@link IllegalArgumentException} when blank.
     *
     * <p>Deliberately NOT {@code @Transactional}: the {@code save} must commit in its own
     * transaction <em>before</em> the async job runs (otherwise the background thread could
     * {@code findById} a not-yet-committed row and hang the sync), and we must not hold a DB
     * connection open across the external {@code validateProfile} HTTP call.</p>
     */
    public LeetCodeConnection connect(UUID userId, String rawUsername) {
        String username = normalizeUsername(rawUsername);
        if (username.isEmpty()) {
            throw new IllegalArgumentException("LeetCode username is required");
        }

        // Synchronous existence/public check — fails fast so the UI can show a precise error.
        collector.validateProfile(username);

        LeetCodeConnection connection = connectionRepository.findByUserId(userId)
                .map(existing -> {
                    existing.setUsername(username);
                    existing.setStatus(SyncStatus.SYNCING);
                    return existing;
                })
                .orElseGet(() -> new LeetCodeConnection(userId, username));
        connection = connectionRepository.save(connection);

        // Off-thread fetch; the connect response returns now and the UI polls for SYNCED.
        collectionJob.runAsync(connection.getId());
        return connection;
    }

    /** Delete the connection record and the LeetCode fragment for this user. Idempotent. */
    @Transactional
    public void disconnect(UUID userId) {
        connectionRepository.deleteByUserId(userId);
        fragmentRepository.deleteByUserIdAndSource(userId, ProfileSource.LEETCODE);
    }

    /**
     * Reduce a raw input to a bare LeetCode handle: strip a pasted profile URL, a leading '@',
     * surrounding whitespace, and any trailing slash. Backend defense-in-depth — the UI also strips.
     */
    static String normalizeUsername(String raw) {
        if (raw == null) {
            return "";
        }
        String value = raw.trim();
        var matcher = URL_HANDLE.matcher(value);
        if (matcher.matches()) {
            value = matcher.group(1);
        }
        if (value.startsWith("@")) {
            value = value.substring(1);
        }
        return value.trim();
    }
}
