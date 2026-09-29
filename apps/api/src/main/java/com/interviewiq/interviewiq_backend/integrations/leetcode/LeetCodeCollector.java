package com.interviewiq.interviewiq_backend.integrations.leetcode;

import com.interviewiq.interviewiq_backend.models.LeetCodeConnection;
import com.interviewiq.interviewiq_backend.models.ProfileFragment;
import com.interviewiq.interviewiq_backend.models.ProfileSource;
import com.interviewiq.interviewiq_backend.repositories.ProfileFragmentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Fetches a user's public LeetCode data via the public GraphQL endpoint, normalizes it into the
 * canonical {@link ProfileFragment} shape, and upserts it only when the content hash changes
 * (idempotency / cost discipline — mirrors {@code GitHubCollector}).
 *
 * <p>No OAuth, no token: LeetCode profiles are public and queried by username.</p>
 */
@Service
public class LeetCodeCollector {

    private static final Logger log = LoggerFactory.getLogger(LeetCodeCollector.class);

    /** Lightweight validation query used by connect — just enough to tell exists/public apart. */
    private static final String VALIDATE_QUERY = """
            query validate($username: String!) {
              matchedUser(username: $username) {
                username
                submitStatsGlobal { acSubmissionNum { difficulty count } }
              }
            }
            """;

    /** Call 1 — profile, solve stats by difficulty, tag-wise solved counts. */
    private static final String PROFILE_QUERY = """
            query userProfile($username: String!) {
              matchedUser(username: $username) {
                username
                profile { realName countryName }
                submitStatsGlobal { acSubmissionNum { difficulty count } }
                tagProblemCounts {
                  advanced { tagName problemsSolved }
                  intermediate { tagName problemsSolved }
                  fundamental { tagName problemsSolved }
                }
              }
            }
            """;

    /** Call 2 — contest stats (null when the user has never entered a contest). */
    private static final String CONTEST_QUERY = """
            query contest($username: String!) {
              userContestRanking(username: $username) {
                attendedContestsCount
                rating
                globalRanking
                totalParticipants
                topPercentage
              }
            }
            """;

    /** Call 3 — recent accepted submissions (drives last-30-day count + preferred language). */
    private static final String RECENT_QUERY = """
            query recent($username: String!) {
              recentAcSubmissionList(username: $username, limit: 20) {
                id title titleSlug timestamp lang
              }
            }
            """;

    private static final int MAX_ATTEMPTS = 3;
    private static final Duration BACKOFF_BASE = Duration.ofMillis(500);
    private static final Duration RECENT_WINDOW = Duration.ofDays(30);

    /** Outcome of a collection run, so the caller can map it to the right connection status. */
    public enum CollectResult {
        /** Fragment was created or updated. */
        STORED,
        /** Hash unchanged — nothing rewritten (idempotent skip). */
        UNCHANGED,
        /** matchedUser came back null — profile vanished/went private after connect. */
        NULL_USER
    }

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final ProfileFragmentRepository fragmentRepository;
    private final String graphQlUrl;

    public LeetCodeCollector(
            RestClient restClient,
            ObjectMapper objectMapper,
            ProfileFragmentRepository fragmentRepository,
            @Value("${leetcode.api.graphql-url}") String graphQlUrl) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
        this.fragmentRepository = fragmentRepository;
        this.graphQlUrl = graphQlUrl;
    }

    // ---------------------------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------------------------

    /**
     * Confirms the username exists and its stats are public. Throws {@link LeetCodeProfileException}
     * with {@code USERNAME_NOT_FOUND} or {@code PROFILE_PRIVATE} otherwise. One lightweight call.
     */
    public void validateProfile(String username) {
        JsonNode data = postGraphQl(VALIDATE_QUERY, username);
        JsonNode matchedUser = data.path("matchedUser");
        if (matchedUser.isMissingNode() || matchedUser.isNull()) {
            throw new LeetCodeProfileException(
                    LeetCodeProfileException.Reason.USERNAME_NOT_FOUND,
                    "LeetCode user not found: " + username);
        }
        // Best-effort privacy check. LeetCode's public GraphQL does not expose a clean "private"
        // flag — an existing user usually returns stats regardless of the website privacy toggle.
        // We treat a present matchedUser with no submit stats as private. HUMAN REVIEW: confirm
        // this heuristic against a genuinely-private account before relying on it in production.
        JsonNode acNums = matchedUser.path("submitStatsGlobal").path("acSubmissionNum");
        if (acNums.isMissingNode() || acNums.isNull() || !acNums.isArray()) {
            throw new LeetCodeProfileException(
                    LeetCodeProfileException.Reason.PROFILE_PRIVATE,
                    "LeetCode profile is not public: " + username);
        }
    }

    /**
     * Fetch all three queries, normalize, hash, and upsert the fragment when the hash changed.
     * Optional queries (contest, recent) that fail are tolerated and flag the fragment {@code partial}.
     */
    @Transactional
    public CollectResult collectAndStore(LeetCodeConnection connection) {
        String username = connection.getUsername();

        // Call 1 is required. A null matchedUser here means the profile vanished post-connect.
        JsonNode profileData = postGraphQl(PROFILE_QUERY, username);
        JsonNode matchedUser = profileData.path("matchedUser");
        if (matchedUser.isMissingNode() || matchedUser.isNull()) {
            return CollectResult.NULL_USER;
        }

        boolean partial = false;

        JsonNode contestData = objectMapper.nullNode();
        try {
            contestData = postGraphQl(CONTEST_QUERY, username);
        } catch (LeetCodeProfileException ex) {
            partial = true;
            log.warn("LeetCode contest query failed for {} ({}); storing partial fragment",
                    username, ex.getCode());
        }

        JsonNode recentData = objectMapper.nullNode();
        try {
            recentData = postGraphQl(RECENT_QUERY, username);
        } catch (LeetCodeProfileException ex) {
            partial = true;
            log.warn("LeetCode recent-submissions query failed for {} ({}); storing partial fragment",
                    username, ex.getCode());
        }

        String canonicalData = toFragmentJson(profileData, contestData, recentData, Instant.now(), partial);
        String hash = sha256(canonicalData);

        Optional<ProfileFragment> existing =
                fragmentRepository.findByUserIdAndSource(connection.getUserId(), ProfileSource.LEETCODE);

        if (existing.isPresent()) {
            ProfileFragment fragment = existing.get();
            if (fragment.getContentHash().equals(hash)) {
                fragment.setFetchedAt(Instant.now());
                fragmentRepository.save(fragment);
                return CollectResult.UNCHANGED;
            }
            fragment.setData(canonicalData);
            fragment.setContentHash(hash);
            fragment.setVersion(fragment.getVersion() + 1);
            fragment.setFetchedAt(Instant.now());
            fragmentRepository.save(fragment);
            return CollectResult.STORED;
        }

        fragmentRepository.save(
                new ProfileFragment(connection.getUserId(), ProfileSource.LEETCODE, canonicalData, hash));
        return CollectResult.STORED;
    }

    // ---------------------------------------------------------------------------------------------
    // Normalization (pure — no network; deterministic for a given `now`)
    // ---------------------------------------------------------------------------------------------

    /**
     * Map the three raw GraphQL {@code data} nodes into the normalized fragment and return it as
     * canonical (key-sorted) JSON, ready for hashing + storage. {@code now} is injected so the
     * 30-day activity window is deterministic and unit-testable.
     */
    public String toFragmentJson(JsonNode profileData, JsonNode contestData, JsonNode recentData,
                                 Instant now, boolean partial) {
        JsonNode matchedUser = safe(profileData).path("matchedUser");

        Map<String, Object> fragment = new LinkedHashMap<>();
        fragment.put("username", matchedUser.path("username").asString(""));
        fragment.put("country", matchedUser.path("profile").path("countryName").asString(""));

        // solved split by difficulty (acSubmissionNum entries: All / Easy / Medium / Hard)
        int easy = 0, medium = 0, hard = 0, total = 0;
        for (JsonNode entry : matchedUser.path("submitStatsGlobal").path("acSubmissionNum")) {
            String difficulty = entry.path("difficulty").asString("");
            int count = entry.path("count").asInt(0);
            switch (difficulty) {
                case "Easy" -> easy = count;
                case "Medium" -> medium = count;
                case "Hard" -> hard = count;
                case "All" -> total = count;
                default -> { /* ignore unknown buckets */ }
            }
        }
        Map<String, Object> solved = new LinkedHashMap<>();
        solved.put("easy", easy);
        solved.put("medium", medium);
        solved.put("hard", hard);
        solved.put("total", total > 0 ? total : easy + medium + hard);
        fragment.put("solved", solved);

        // tag-wise solved counts merged across all three tiers, descending, capped
        List<Map<String, Object>> byTopic = new ArrayList<>();
        JsonNode tags = matchedUser.path("tagProblemCounts");
        for (String tier : List.of("advanced", "intermediate", "fundamental")) {
            for (JsonNode tag : tags.path(tier)) {
                int count = tag.path("problemsSolved").asInt(0);
                String topic = tag.path("tagName").asString("");
                if (count > 0 && !topic.isEmpty()) {
                    Map<String, Object> t = new LinkedHashMap<>();
                    t.put("topic", topic);
                    t.put("count", count);
                    byTopic.add(t);
                }
            }
        }
        byTopic.sort(Comparator
                .comparingInt((Map<String, Object> t) -> -((Integer) t.get("count")))
                .thenComparing(t -> (String) t.get("topic")));
        fragment.put("byTopic", byTopic); // all solved topics, sorted desc — no cap

        // contest stats — null when the user has never entered a contest
        JsonNode contest = safe(contestData).path("userContestRanking");
        if (contest.isObject()) {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("attended", contest.path("attendedContestsCount").asInt(0));
            c.put("rating", (int) Math.round(contest.path("rating").asDouble(0)));
            c.put("globalRanking", contest.path("globalRanking").asInt(0));
            c.put("totalParticipants", contest.path("totalParticipants").asInt(0));
            c.put("topPercent", Math.round(contest.path("topPercentage").asDouble(0) * 100.0) / 100.0);
            fragment.put("contest", c);
        } else {
            fragment.put("contest", null);
        }

        // recent activity — last-30-day accepted count + preferred (most-frequent) language
        int last30Days = 0;
        Map<String, Integer> langCounts = new LinkedHashMap<>();
        long cutoff = now.minus(RECENT_WINDOW).getEpochSecond();
        for (JsonNode sub : safe(recentData).path("recentAcSubmissionList")) {
            long ts = parseEpochSeconds(sub.path("timestamp").asString(""));
            if (ts >= cutoff) {
                last30Days++;
            }
            String lang = sub.path("lang").asString("");
            if (!lang.isEmpty()) {
                langCounts.merge(lang, 1, Integer::sum);
            }
        }
        String preferredLanguage = langCounts.entrySet().stream()
                .sorted(Comparator
                        .comparingInt((Map.Entry<String, Integer> e) -> -e.getValue())
                        .thenComparing(Map.Entry::getKey))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElse(null);
        Map<String, Object> recentActivity = new LinkedHashMap<>();
        recentActivity.put("last30Days", last30Days);
        recentActivity.put("preferredLanguage", preferredLanguage);
        fragment.put("recentActivity", recentActivity);

        // streak: out of scope — LeetCode does not expose it on public profiles (left null)
        fragment.put("streak", null);
        fragment.put("partial", partial);

        return canonicalize(objectMapper.valueToTree(fragment));
    }

    // ---------------------------------------------------------------------------------------------
    // GraphQL transport with retry/backoff
    // ---------------------------------------------------------------------------------------------

    /**
     * POST a GraphQL query and return its {@code data} node. Retries 429/5xx/I-O with exponential
     * backoff. Throws {@link LeetCodeProfileException} (RATE_LIMITED / UNREACHABLE) when exhausted.
     * A {@code data} present with a null business field (e.g. matchedUser null) is returned as-is —
     * the caller decides what null means.
     */
    private JsonNode postGraphQl(String query, String username) {
        Map<String, Object> body = Map.of(
                "query", query,
                "variables", Map.of("username", username));

        RuntimeException last = null;
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                String response = restClient.post()
                        .uri(graphQlUrl)
                        .header("Referer", "https://leetcode.com")
                        .header("User-Agent", "interviewiq-backend")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .body(String.class);

                JsonNode root = objectMapper.readTree(response);
                JsonNode data = root.path("data");
                if (data.isMissingNode() || data.isNull()) {
                    // No data at all => an unhandled GraphQL error, not an expected business null.
                    throw new LeetCodeProfileException(
                            LeetCodeProfileException.Reason.UNREACHABLE,
                            "LeetCode GraphQL returned no data: " + root.path("errors"));
                }
                return data;
            } catch (HttpStatusCodeException ex) {
                int status = ex.getStatusCode().value();
                if (status == 429) {
                    last = new LeetCodeProfileException(
                            LeetCodeProfileException.Reason.RATE_LIMITED,
                            "LeetCode rate-limited (429)", ex);
                } else if (status >= 500) {
                    last = new LeetCodeProfileException(
                            LeetCodeProfileException.Reason.UNREACHABLE,
                            "LeetCode server error (" + status + ")", ex);
                } else {
                    // Other 4xx are not retryable.
                    throw new LeetCodeProfileException(
                            LeetCodeProfileException.Reason.UNREACHABLE,
                            "LeetCode request failed (" + status + ")", ex);
                }
            } catch (LeetCodeProfileException ex) {
                throw ex; // already classified (e.g. no-data)
            } catch (RestClientException ex) {
                last = new LeetCodeProfileException(
                        LeetCodeProfileException.Reason.UNREACHABLE,
                        "LeetCode unreachable: " + ex.getMessage(), ex);
            }

            if (attempt < MAX_ATTEMPTS) {
                sleepBackoff(attempt);
            }
        }
        throw last != null ? last : new LeetCodeProfileException(
                LeetCodeProfileException.Reason.UNREACHABLE, "LeetCode request failed");
    }

    private void sleepBackoff(int attempt) {
        try {
            Thread.sleep(BACKOFF_BASE.toMillis() * (1L << (attempt - 1)));
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new LeetCodeProfileException(
                    LeetCodeProfileException.Reason.UNREACHABLE, "Interrupted during backoff", ie);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Canonical JSON + hashing (mirrors GitHubCollector so fragments hash consistently)
    // ---------------------------------------------------------------------------------------------

    /** Serialize with map keys sorted, producing deterministic bytes for hashing. */
    public String canonicalize(JsonNode node) {
        return objectMapper.writer()
                .with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                .writeValueAsString(sortNode(node));
    }

    private JsonNode sortNode(JsonNode node) {
        if (node.isObject()) {
            ObjectNode sorted = objectMapper.createObjectNode();
            List<String> names = new ArrayList<>();
            node.propertyNames().forEach(names::add);
            names.sort(Comparator.naturalOrder());
            for (String name : names) {
                sorted.set(name, sortNode(node.get(name)));
            }
            return sorted;
        }
        if (node.isArray()) {
            ArrayNode arr = objectMapper.createArrayNode();
            for (JsonNode child : node) {
                arr.add(sortNode(child));
            }
            return arr;
        }
        return node;
    }

    public static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not hash fragment data", ex);
        }
    }

    private JsonNode safe(JsonNode node) {
        return node == null ? objectMapper.nullNode() : node;
    }

    private long parseEpochSeconds(String value) {
        if (value == null || value.isBlank()) {
            return 0L;
        }
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException ex) {
            return 0L;
        }
    }
}
