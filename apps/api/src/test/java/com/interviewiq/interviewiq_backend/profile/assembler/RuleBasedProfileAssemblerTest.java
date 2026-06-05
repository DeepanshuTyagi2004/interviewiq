package com.interviewiq.interviewiq_backend.profile.assembler;

import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class RuleBasedProfileAssemblerTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RuleBasedProfileAssembler assembler = new RuleBasedProfileAssembler(objectMapper);

    private ProfileFragment githubFragment() {
        String data = """
                {
                  "login":"aishav","name":"Aisha Verma","avatarUrl":"x",
                  "joinedYear":2021,"publicRepos":38,
                  "contributions":{"lastYear":1204,"weeks":[]},
                  "languages":[
                    {"name":"TypeScript","pct":48,"bytes":1234567},
                    {"name":"Python","pct":30,"bytes":700000}
                  ],
                  "externalPRs":17,
                  "topRepos":[{"name":"campus-placement-bot","stars":42,"primaryLang":"TypeScript"}]
                }
                """;
        return new ProfileFragment(UUID.randomUUID(), ProfileSource.GITHUB, data, "hash");
    }

    @Test
    void assemble_buildsNotableFromContributionsAndPRs() {
        var bands = assembler.assemble(List.of(githubFragment()));

        assertThat(bands.notable())
                .anySatisfy(n -> {
                    assertThat(n.text()).contains("1,204").contains("contributions");
                    assertThat(n.source()).isEqualTo("GITHUB");
                });
        assertThat(bands.notable())
                .anySatisfy(n -> assertThat(n.text()).contains("17").contains("pull request"));
    }

    @Test
    void assemble_skillsCarryEvidenceNamingTheSource() {
        var bands = assembler.assemble(List.of(githubFragment()));

        assertThat(bands.mostUsedSkills()).isNotEmpty();
        assertThat(bands.mostUsedSkills().get(0).skill()).isEqualTo("TypeScript");
        assertThat(bands.mostUsedSkills().get(0).evidence()).isEqualTo("GitHub 48%");
        // every skill must carry evidence (CLAUDE.md hard rule)
        assertThat(bands.mostUsedSkills())
                .allSatisfy(s -> assertThat(s.evidence()).isNotBlank());
    }

    @Test
    void assemble_atAGlanceDescribesActivity() {
        var bands = assembler.assemble(List.of(githubFragment()));
        assertThat(bands.atAGlance()).isNotEmpty();
        assertThat(String.join(" ", bands.atAGlance())).contains("38 repos");
    }

    @Test
    void assemble_outputContainsNoScoringOrRankingFields() {
        var bands = assembler.assemble(List.of(githubFragment()));
        // Serialize the whole bands object and assert no forbidden comparative vocabulary.
        String json = objectMapper.writeValueAsString(bands).toLowerCase();
        assertThat(json)
                // key-name guards (e.g. {"score":...} in serialized JSON)
                .doesNotContain("\"score\"")
                .doesNotContain("\"rating\"")
                .doesNotContain("\"rank\"")
                .doesNotContain("\"grade\"")
                // value-text guards — unquoted so they catch comparative words inside string values too
                .doesNotContain("score")
                .doesNotContain("rating")
                .doesNotContain("rank")
                .doesNotContain("grade")
                .doesNotContain("percentile")
                .doesNotContain("above average")
                .doesNotContain("better than");
    }

    @Test
    void assemble_withNoFragments_returnsEmptyBands() {
        var bands = assembler.assemble(List.of());
        assertThat(bands.notable()).isEmpty();
        assertThat(bands.mostUsedSkills()).isEmpty();
        assertThat(bands.atAGlance()).isEmpty();
    }
}
