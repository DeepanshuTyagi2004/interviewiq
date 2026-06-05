package com.interviewiq.interviewiq_backend.profile.github;

import com.interviewiq.interviewiq_backend.profile.crypto.TokenCipher;
import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
import com.interviewiq.interviewiq_backend.profile.repository.ProfileFragmentRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.SerializationFeature;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class GitHubCollector {

    private static final String GRAPHQL_QUERY = """
            query {
              viewer {
                login
                name
                avatarUrl
                createdAt
                repositories(first: 100, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
                  totalCount
                  nodes {
                    name
                    stargazerCount
                    pushedAt
                    isFork
                    primaryLanguage { name }
                    languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                      edges { size node { name } }
                    }
                  }
                }
                contributionsCollection {
                  contributionCalendar {
                    totalContributions
                    weeks { contributionDays { contributionCount } }
                  }
                  pullRequestContributionsByRepository(maxRepositories: 100) {
                    repository { owner { login } }
                    contributions { totalCount }
                  }
                }
              }
            }
            """;

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final TokenCipher tokenCipher;
    private final ProfileFragmentRepository fragmentRepository;
    private final String graphQlUrl;

    public GitHubCollector(
            RestClient restClient,
            ObjectMapper objectMapper,
            TokenCipher tokenCipher,
            ProfileFragmentRepository fragmentRepository,
            @Value("${github.api.graphql-url}") String graphQlUrl) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
        this.tokenCipher = tokenCipher;
        this.fragmentRepository = fragmentRepository;
        this.graphQlUrl = graphQlUrl;
    }

    /**
     * Fetch from GitHub for the given connection, map to the normalized fragment,
     * and upsert the ProfileFragment only if the content hash changed.
     */
    @Transactional
    public void collectAndStore(GitHubConnection connection) {
        String accessToken = tokenCipher.decrypt(connection.getAccessTokenEnc());
        JsonNode root = postGraphQl(accessToken);
        String canonicalData = toFragmentJson(root);
        String hash = sha256(canonicalData);

        Optional<ProfileFragment> existing =
                fragmentRepository.findByUserIdAndSource(connection.getUserId(), ProfileSource.GITHUB);

        if (existing.isPresent()) {
            ProfileFragment fragment = existing.get();
            if (fragment.getContentHash().equals(hash)) {
                // unchanged: just bump fetchedAt (idempotent — cost discipline)
                fragment.setFetchedAt(Instant.now());
            } else {
                fragment.setData(canonicalData);
                fragment.setContentHash(hash);
                fragment.setVersion(fragment.getVersion() + 1);
                fragment.setFetchedAt(Instant.now());
            }
            fragmentRepository.save(fragment);
        } else {
            fragmentRepository.save(
                    new ProfileFragment(connection.getUserId(), ProfileSource.GITHUB, canonicalData, hash));
        }
    }

    private JsonNode postGraphQl(String accessToken) {
        Map<String, String> body = Map.of("query", GRAPHQL_QUERY);
        String response = restClient.post()
                .uri(graphQlUrl)
                .header("Authorization", "Bearer " + accessToken)
                .header("User-Agent", "interviewiq-backend")
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(response);
    }

    /**
     * Map the raw GraphQL JSON into the normalized fragment (spec §4) and return
     * it as canonical (key-sorted) JSON, ready for hashing + storage.
     */
    public String toFragmentJson(JsonNode root) {
        JsonNode viewer = root.path("data").path("viewer");

        Map<String, Object> fragment = new LinkedHashMap<>();
        fragment.put("login", viewer.path("login").asString(""));
        fragment.put("name", viewer.path("name").asString(""));
        fragment.put("avatarUrl", viewer.path("avatarUrl").asString(""));
        fragment.put("joinedYear", parseYear(viewer.path("createdAt").asString("")));
        fragment.put("publicRepos", viewer.path("repositories").path("totalCount").asInt(0));

        // contributions: lastYear total + 52x7 weeks grid
        JsonNode calendar = viewer.path("contributionsCollection").path("contributionCalendar");
        Map<String, Object> contributions = new LinkedHashMap<>();
        contributions.put("lastYear", calendar.path("totalContributions").asInt(0));
        List<List<Integer>> weeks = new ArrayList<>();
        for (JsonNode week : calendar.path("weeks")) {
            List<Integer> days = new ArrayList<>();
            for (JsonNode day : week.path("contributionDays")) {
                days.add(day.path("contributionCount").asInt(0));
            }
            weeks.add(days);
        }
        contributions.put("weeks", weeks);
        fragment.put("contributions", contributions);

        // languages: aggregate bytes across NON-FORK repos, percentages, sorted desc
        Map<String, Long> bytesByLang = new LinkedHashMap<>();
        List<Map<String, Object>> topRepos = new ArrayList<>();
        for (JsonNode repo : viewer.path("repositories").path("nodes")) {
            if (repo.path("isFork").asBoolean(false)) {
                continue; // skip-list: forks
            }
            for (JsonNode edge : repo.path("languages").path("edges")) {
                String lang = edge.path("node").path("name").asString("");
                long size = edge.path("size").asLong(0);
                if (!lang.isEmpty()) {
                    bytesByLang.merge(lang, size, Long::sum);
                }
            }
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("name", repo.path("name").asString(""));
            r.put("stars", repo.path("stargazerCount").asInt(0));
            r.put("primaryLang", repo.path("primaryLanguage").path("name").asString(""));
            topRepos.add(r);
        }
        long totalBytes = bytesByLang.values().stream().mapToLong(Long::longValue).sum();
        List<Map<String, Object>> languages = new ArrayList<>();
        bytesByLang.entrySet().stream()
                .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                .forEach(e -> {
                    Map<String, Object> l = new LinkedHashMap<>();
                    l.put("name", e.getKey());
                    l.put("pct", totalBytes == 0 ? 0 : Math.round(e.getValue() * 100.0 / totalBytes));
                    l.put("bytes", e.getValue());
                    languages.add(l);
                });
        fragment.put("languages", languages);

        // topRepos: by stars desc, keep top 10 (recent-push order preserved from query as tiebreak)
        topRepos.sort(Comparator.comparingInt(r -> -((Integer) r.get("stars"))));
        fragment.put("topRepos", topRepos.size() > 10 ? topRepos.subList(0, 10) : topRepos);

        // externalPRs: PRs to repos NOT owned by the viewer (skip self-owned)
        String login = viewer.path("login").asString("");
        int externalPRs = 0;
        for (JsonNode prRepo : viewer.path("contributionsCollection")
                .path("pullRequestContributionsByRepository")) {
            String owner = prRepo.path("repository").path("owner").path("login").asString("");
            if (!owner.equals(login)) {
                externalPRs += prRepo.path("contributions").path("totalCount").asInt(0);
            }
        }
        fragment.put("externalPRs", externalPRs);

        // serialize to canonical (key-sorted) JSON
        JsonNode tree = objectMapper.valueToTree(fragment);
        return canonicalize(tree);
    }

    /** Serialize a JsonNode with map keys sorted, producing deterministic bytes for hashing. */
    public String canonicalize(JsonNode node) {
        return objectMapper.writer()
                .with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                .writeValueAsString(sortNode(node));
    }

    /** Recursively rebuild the node so object keys are sorted (arrays keep order). */
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

    private int parseYear(String iso) {
        if (iso == null || iso.length() < 4) {
            return 0;
        }
        return Integer.parseInt(iso.substring(0, 4));
    }
}
