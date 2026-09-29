package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanCodingProfile;
import com.interviewiq.interviewiq_backend.models.ProfileSource;
import com.interviewiq.interviewiq_backend.repositories.ProfileFragmentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.UUID;

/**
 * Curates a user's GitHub + LeetCode {@code ProfileFragment}s into the compact, stable coding
 * signals the interview-prep pipeline grounds coding rounds in. Keeps only the useful, low-churn
 * sub-objects (GitHub languages/topRepos/contributionsLastYear, LeetCode solved/byTopic/contest) —
 * the volatile weekly contribution grid is intentionally dropped so it doesn't invalidate the
 * plan's input-hash cache. Returns nulls for any source the user hasn't connected.
 */
@Component
public class CodingSignalsProvider {

    private static final Logger log = LoggerFactory.getLogger(CodingSignalsProvider.class);

    private final ProfileFragmentRepository fragments;
    private final ObjectMapper objectMapper;

    public CodingSignalsProvider(ProfileFragmentRepository fragments, ObjectMapper objectMapper) {
        this.fragments = fragments;
        this.objectMapper = objectMapper;
    }

    public PlanCodingProfile forUser(UUID userId) {
        return new PlanCodingProfile(githubSummary(userId), leetcodeSummary(userId));
    }

    private JsonNode githubSummary(UUID userId) {
        JsonNode f = readFragment(userId, ProfileSource.GITHUB);
        if (f == null) {
            return null;
        }
        ObjectNode s = objectMapper.createObjectNode();
        copy(s, f, "languages");
        copy(s, f, "topRepos");
        copy(s, f, "externalPRs");
        JsonNode contributions = f.get("contributions");
        if (contributions != null && contributions.has("lastYear")) {
            s.set("contributionsLastYear", contributions.get("lastYear"));
        }
        return s;
    }

    private JsonNode leetcodeSummary(UUID userId) {
        JsonNode f = readFragment(userId, ProfileSource.LEETCODE);
        if (f == null) {
            return null;
        }
        ObjectNode s = objectMapper.createObjectNode();
        copy(s, f, "solved");
        copy(s, f, "byTopic");
        copy(s, f, "contest");
        copy(s, f, "recentActivity");
        return s;
    }

    private static void copy(ObjectNode target, JsonNode source, String field) {
        JsonNode v = source.get(field);
        if (v != null && !v.isNull()) {
            target.set(field, v);
        }
    }

    private JsonNode readFragment(UUID userId, ProfileSource source) {
        return fragments.findByUserIdAndSource(userId, source)
                .map(fr -> {
                    try {
                        return objectMapper.readTree(fr.getData());
                    } catch (RuntimeException ex) {
                        log.warn("coding signals: unreadable {} fragment for {}: {}",
                                source, userId, ex.getMessage());
                        return (JsonNode) null;
                    }
                })
                .orElse(null);
    }
}
