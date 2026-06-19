package com.interviewiq.interviewiq_backend.integrations.leetcode;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class LeetCodeCollectorTest {

    // 2024-06-01T00:00:00Z — fixed so the 30-day window assertion is deterministic.
    private static final Instant NOW = Instant.parse("2024-06-01T00:00:00Z");

    private final ObjectMapper objectMapper = new ObjectMapper();
    private LeetCodeCollector collector;
    private JsonNode profileData;
    private JsonNode contestData;
    private JsonNode recentData;

    @BeforeEach
    void setUp() {
        // Network deps are not exercised here; pass nulls for RestClient + fragment repo.
        collector = new LeetCodeCollector(null, objectMapper, null, "https://leetcode.com/graphql");
        profileData = load("fixtures/leetcode-profile-response.json").path("data");
        contestData = load("fixtures/leetcode-contest-response.json").path("data");
        recentData = load("fixtures/leetcode-recent-response.json").path("data");
    }

    private JsonNode load(String path) {
        try (InputStream is = getClass().getClassLoader().getResourceAsStream(path)) {
            if (is == null) throw new IllegalStateException("Fixture not found: " + path);
            return objectMapper.readTree(new String(is.readAllBytes(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void toFragmentJson_mapsProfileAndSolvedSplit() {
        JsonNode f = objectMapper.readTree(
                collector.toFragmentJson(profileData, contestData, recentData, NOW, false));

        assertThat(f.get("username").asString()).isEqualTo("aakash_42");
        assertThat(f.get("country").asString()).isEqualTo("India");
        assertThat(f.get("solved").get("easy").asInt()).isEqualTo(78);
        assertThat(f.get("solved").get("medium").asInt()).isEqualTo(268);
        assertThat(f.get("solved").get("hard").asInt()).isEqualTo(66);
        assertThat(f.get("solved").get("total").asInt()).isEqualTo(412);
    }

    @Test
    void toFragmentJson_mergesAndSortsTopicsDescending_excludingZeroes() {
        JsonNode topics = objectMapper.readTree(
                collector.toFragmentJson(profileData, contestData, recentData, NOW, false)).get("byTopic");

        // Array(90), String(60), Hash Table(55), Dynamic Programming(40), Greedy(30), Backtracking(10).
        // "Suffix Array" (0 solved) must be excluded.
        assertThat(topics).hasSize(6);
        assertThat(topics.get(0).get("topic").asString()).isEqualTo("Array");
        assertThat(topics.get(0).get("count").asInt()).isEqualTo(90);
        assertThat(topics.get(1).get("topic").asString()).isEqualTo("String");
        assertThat(topics.toString()).doesNotContain("Suffix Array");
    }

    @Test
    void toFragmentJson_mapsContestStatsWithRoundedRating() {
        JsonNode contest = objectMapper.readTree(
                collector.toFragmentJson(profileData, contestData, recentData, NOW, false)).get("contest");

        assertThat(contest.get("attended").asInt()).isEqualTo(12);
        assertThat(contest.get("rating").asInt()).isEqualTo(1751); // 1750.6 rounded
        assertThat(contest.get("globalRanking").asInt()).isEqualTo(50000);
        assertThat(contest.get("topPercent").asDouble()).isEqualTo(6.25);
    }

    @Test
    void toFragmentJson_nullContest_whenUserHasNoContestHistory() {
        JsonNode f = objectMapper.readTree(
                collector.toFragmentJson(profileData, objectMapper.nullNode(), recentData, NOW, false));
        assertThat(f.get("contest").isNull()).isTrue();
    }

    @Test
    void toFragmentJson_derivesRecentCountAndPreferredLanguage() {
        JsonNode activity = objectMapper.readTree(
                collector.toFragmentJson(profileData, contestData, recentData, NOW, false)).get("recentActivity");

        // 3 of 4 submissions fall inside the 30-day window relative to NOW.
        assertThat(activity.get("last30Days").asInt()).isEqualTo(3);
        // python3 appears twice -> preferred.
        assertThat(activity.get("preferredLanguage").asString()).isEqualTo("python3");
    }

    @Test
    void toFragmentJson_leavesStreakNull_andFlagsPartial() {
        JsonNode f = objectMapper.readTree(
                collector.toFragmentJson(profileData, contestData, recentData, NOW, true));
        assertThat(f.get("streak").isNull()).isTrue();
        assertThat(f.get("partial").asBoolean()).isTrue();
    }

    @Test
    void contentHash_isStableForSameInput_andChangesWhenDataChanges() {
        String c1 = collector.toFragmentJson(profileData, contestData, recentData, NOW, false);
        String c2 = collector.toFragmentJson(profileData, contestData, recentData, NOW, false);
        assertThat(LeetCodeCollector.sha256(c1)).isEqualTo(LeetCodeCollector.sha256(c2));

        JsonNode mutated = objectMapper.readTree(c1.replace("\"hard\":66", "\"hard\":67"));
        assertThat(LeetCodeCollector.sha256(collector.canonicalize(mutated)))
                .isNotEqualTo(LeetCodeCollector.sha256(c1));
    }

    @Test
    void canonicalize_isKeyOrderIndependent() {
        JsonNode a = objectMapper.readTree("{\"b\":1,\"a\":2}");
        JsonNode b = objectMapper.readTree("{\"a\":2,\"b\":1}");
        assertThat(collector.canonicalize(a)).isEqualTo(collector.canonicalize(b));
    }
}
