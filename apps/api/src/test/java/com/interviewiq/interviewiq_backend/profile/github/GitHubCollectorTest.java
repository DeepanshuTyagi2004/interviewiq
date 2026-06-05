package com.interviewiq.interviewiq_backend.profile.github;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class GitHubCollectorTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private GitHubCollector collector;
    private JsonNode fixtureRoot;

    @BeforeEach
    void setUp() throws Exception {
        // GitHubCollector's network deps are not exercised here; pass nulls for the
        // RestClient + token cipher + repo (mapping/hashing methods don't touch them).
        collector = new GitHubCollector(null, objectMapper, null, null,
                "https://api.github.com/graphql");
        String json = Files.readString(
                Path.of("src/test/resources/fixtures/github-graphql-response.json"),
                StandardCharsets.UTF_8);
        fixtureRoot = objectMapper.readTree(json);
    }

    @Test
    void toFragmentJson_mapsCoreProfileFields() {
        String canonical = collector.toFragmentJson(fixtureRoot);
        JsonNode f = objectMapper.readTree(canonical);

        assertThat(f.get("login").asString()).isEqualTo("aishav");
        assertThat(f.get("name").asString()).isEqualTo("Aisha Verma");
        assertThat(f.get("joinedYear").asInt()).isEqualTo(2021);
        assertThat(f.get("publicRepos").asInt()).isEqualTo(38);
        assertThat(f.get("contributions").get("lastYear").asInt()).isEqualTo(1204);
    }

    @Test
    void toFragmentJson_excludesForksAndComputesExternalPRs() {
        String canonical = collector.toFragmentJson(fixtureRoot);
        JsonNode f = objectMapper.readTree(canonical);

        // forked-stuff must NOT appear in topRepos (skip-list: forks)
        assertThat(f.get("topRepos").toString()).doesNotContain("forked-stuff");
        // external PRs = PRs to repos NOT owned by the user = 9 (vercel) + 8 (facebook) = 17
        assertThat(f.get("externalPRs").asInt()).isEqualTo(17);
    }

    @Test
    void toFragmentJson_buildsLanguagePercentagesFromNonForkBytes() {
        String canonical = collector.toFragmentJson(fixtureRoot);
        JsonNode f = objectMapper.readTree(canonical);
        JsonNode languages = f.get("languages");

        // TS 800k + Python 400k + CSS 200k = 1.4M non-fork bytes
        // TS = 800000/1400000 = 57%, Python = 28%, CSS = 14%
        assertThat(languages.get(0).get("name").asString()).isEqualTo("TypeScript");
        assertThat(languages.get(0).get("pct").asInt()).isEqualTo(57);
    }

    @Test
    void contentHash_isStableForSameInput_andChangesWhenDataChanges() {
        String canonical1 = collector.toFragmentJson(fixtureRoot);
        String canonical2 = collector.toFragmentJson(fixtureRoot);
        assertThat(GitHubCollector.sha256(canonical1))
                .isEqualTo(GitHubCollector.sha256(canonical2));

        // mutate one field -> different canonical JSON -> different hash
        JsonNode mutated = objectMapper.readTree(
                canonical1.replace("\"lastYear\":1204", "\"lastYear\":1205"));
        String mutatedCanonical = collector.canonicalize(mutated);
        assertThat(GitHubCollector.sha256(mutatedCanonical))
                .isNotEqualTo(GitHubCollector.sha256(canonical1));
    }

    @Test
    void canonicalize_isKeyOrderIndependent() {
        JsonNode a = objectMapper.readTree("{\"b\":1,\"a\":2}");
        JsonNode b = objectMapper.readTree("{\"a\":2,\"b\":1}");
        assertThat(collector.canonicalize(a)).isEqualTo(collector.canonicalize(b));
    }
}
