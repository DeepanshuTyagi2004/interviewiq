package com.interviewiq.interviewiq_backend.profile.assembler;

import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
import com.interviewiq.interviewiq_backend.profile.web.dto.NotableItem;
import com.interviewiq.interviewiq_backend.profile.web.dto.SkillItem;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

@Component
public class RuleBasedProfileAssembler implements ProfileAssembler {

    private final ObjectMapper objectMapper;
    private final NumberFormat grouping = NumberFormat.getIntegerInstance(Locale.US);

    public RuleBasedProfileAssembler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
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
                        grouping.format(lastYear) + " GitHub contributions in the last year",
                        "GITHUB"));
            }
            int externalPRs = g.path("externalPRs").asInt(0);
            if (externalPRs > 0) {
                notable.add(new NotableItem(
                        externalPRs + " external pull request contributions to other projects",
                        "GITHUB"));
            }

            // most-used skills from language percentages, evidence names the source
            for (JsonNode lang : g.path("languages")) {
                String name = lang.path("name").asString("");
                int pct = lang.path("pct").asInt(0);
                if (!name.isEmpty()) {
                    skills.add(new SkillItem(name, "GitHub " + pct + "%"));
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

        return new Bands(notable, skills, atAGlance);
    }
}
