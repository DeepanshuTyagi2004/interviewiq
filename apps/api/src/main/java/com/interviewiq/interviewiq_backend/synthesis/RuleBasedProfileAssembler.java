package com.interviewiq.interviewiq_backend.synthesis;

import com.interviewiq.interviewiq_backend.models.ProfileFragment;
import com.interviewiq.interviewiq_backend.models.ProfileSource;
import com.interviewiq.interviewiq_backend.dtos.NotableItem;
import com.interviewiq.interviewiq_backend.dtos.SkillItem;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

@Component
public class RuleBasedProfileAssembler implements ProfileAssembler {

    /** A GitHub language below this byte-share % is "trace" — excluded from most-used skills. */
    private static final int RELEVANT_LANGUAGE_PCT = 5;
    /** A LeetCode topic counts as a skill only when solved at least this many times. No cap. */
    private static final int LEETCODE_TOPIC_MIN_SOLVES = 5;

    private final ObjectMapper objectMapper;

    public RuleBasedProfileAssembler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * Thread-safe integer formatting with US grouping separators (e.g. 1,204).
     * Locale.US is pinned so behaviour is identical regardless of JVM default locale.
     */
    private static String formatInt(int n) {
        return String.format(Locale.US, "%,d", n);
    }

    @Override
    public Bands assemble(List<ProfileFragment> fragments) {
        List<NotableItem> notable = new ArrayList<>();
        List<SkillItem> skills = new ArrayList<>();
        List<String> atAGlance = new ArrayList<>();

        Optional<JsonNode> github = fragments.stream()
                .filter(f -> f.getSource() == ProfileSource.GITHUB)
                .map(f -> objectMapper.readTree(f.getData()))
                .findFirst();

        github.ifPresent(g -> {
            int lastYear = g.path("contributions").path("lastYear").asInt(0);
            if (lastYear > 0) {
                notable.add(new NotableItem(
                        formatInt(lastYear) + " GitHub contributions in the last year",
                        "GITHUB"));
            }
            int externalPRs = g.path("externalPRs").asInt(0);
            if (externalPRs > 0) {
                notable.add(new NotableItem(
                        externalPRs + " external pull request contributions to other projects",
                        "GITHUB"));
            }

            // most-used skills from language percentages; trace languages (< RELEVANT_LANGUAGE_PCT)
            // are dropped so a repo touching 1% of a language isn't surfaced as a skill. No cap.
            for (JsonNode lang : g.path("languages")) {
                String name = lang.path("name").asString("");
                int pct = lang.path("pct").asInt(0);
                if (!name.isEmpty() && pct >= RELEVANT_LANGUAGE_PCT) {
                    skills.add(new SkillItem(name, "GitHub " + pct + "%", "GITHUB"));
                }
            }

            // at-a-glance: top languages across repo count (descriptive, no comparison)
            int publicRepos = g.path("publicRepos").asInt(0);
            List<String> topLangs = new ArrayList<>();
            for (JsonNode lang : g.path("languages")) {
                topLangs.add(lang.path("name").asString(""));
                if (topLangs.size() == 2) {
                    break;
                }
            }
            if (!topLangs.isEmpty()) {
                atAGlance.add("Most active in " + String.join(" and ", topLangs)
                        + " across " + publicRepos + " repos");
            }
        });

        Optional<JsonNode> leetcode = fragments.stream()
                .filter(f -> f.getSource() == ProfileSource.LEETCODE)
                .map(f -> objectMapper.readTree(f.getData()))
                .findFirst();

        leetcode.ifPresent(lc -> {
            JsonNode solved = lc.path("solved");
            int total = solved.path("total").asInt(0);
            if (total > 0) {
                int easy = solved.path("easy").asInt(0);
                int medium = solved.path("medium").asInt(0);
                int hard = solved.path("hard").asInt(0);
                notable.add(new NotableItem(
                        formatInt(total) + " LeetCode problems solved ("
                                + easy + " Easy, " + medium + " Medium, " + hard + " Hard)",
                        "LEETCODE"));
            }

            // Contest activity, described — never used to rank/grade the user.
            JsonNode contest = lc.path("contest");
            if (contest.isObject()) {
                int attended = contest.path("attended").asInt(0);
                int rating = contest.path("rating").asInt(0);
                if (attended > 0) {
                    String text = "Competed in " + attended + " LeetCode contest"
                            + (attended == 1 ? "" : "s");
                    if (rating > 0) {
                        text += " (rating " + rating + ")";
                    }
                    notable.add(new NotableItem(text, "LEETCODE"));
                }
            }

            // Preferred language as a skill; evidence names the source (CLAUDE.md hard rule).
            String preferredLanguage =
                    lc.path("recentActivity").path("preferredLanguage").asString("");
            if (!preferredLanguage.isEmpty()) {
                skills.add(new SkillItem(
                        preferredLanguage, "LeetCode preferred (recent submissions)", "LEETCODE"));
            }

            // LeetCode topics: a topic is a skill when solved more than LEETCODE_TOPIC_MIN_SOLVES
            // times. No cap on how many qualify. byTopic is the collector's full, pre-sorted set.
            List<String> topTopics = new ArrayList<>();
            for (JsonNode t : lc.path("byTopic")) {
                String topic = t.path("topic").asString("");
                int count = t.path("count").asInt(0);
                if (topic.isEmpty() || count <= 0) {
                    continue;
                }
                if (topTopics.size() < 2) {
                    topTopics.add(topic); // headline topics for the at-a-glance line
                }
                if (count >= LEETCODE_TOPIC_MIN_SOLVES) {
                    skills.add(new SkillItem(topic, "LeetCode: " + count + " solved", "LEETCODE"));
                }
            }

            if (total > 0) {
                StringBuilder glance = new StringBuilder("Solved " + formatInt(total) + " LeetCode problems");
                if (!topTopics.isEmpty()) {
                    glance.append("; most-solved topics: ")
                            .append(String.join(", ", topTopics.subList(0, Math.min(2, topTopics.size()))));
                }
                atAGlance.add(glance.toString());
            }
        });

        return new Bands(notable, skills, atAGlance);
    }
}
