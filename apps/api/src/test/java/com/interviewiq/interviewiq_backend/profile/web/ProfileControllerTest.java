package com.interviewiq.interviewiq_backend.profile.web;

import com.interviewiq.interviewiq_backend.profile.service.ProfileService;
import com.interviewiq.interviewiq_backend.profile.web.dto.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;

/**
 * Slice test for {@link ProfileController}.
 *
 * <p>Two non-trivial test-infrastructure challenges:
 * <ol>
 *   <li><b>Path-segment API versioning</b> — {@code spring.mvc.apiversion.use.path-segment=1}
 *       activates Spring MVC 7's path-segment versioning (segment index 1 = "v1" in
 *       {@code /api/v1/...}) so that {@code @RequestMapping(version="1")} is honoured and
 *       {@code GET /api/v1/profile/me} resolves to {@link ProfileController#me}.</li>
 *   <li><b>Security</b> — the real SecurityConfig requires DB-backed beans; the inner
 *       {@link TestSecurityConfig} replaces it with a minimal filter chain that enforces
 *       authentication (for the 401 test) and enables the JWT resource-server filter so
 *       {@code @AuthenticationPrincipal Jwt} resolves. The {@code jwt()} MockMvc
 *       post-processor injects a synthetic JWT principal — the mock {@link JwtDecoder}
 *       is never called.</li>
 * </ol>
 */
@WebMvcTest(
        controllers = ProfileController.class,
        // spring.mvc.apiversion.use.path-segment is an Integer (the segment index).
        // Value 1 means extract the version from /api/{v}/... at position 1 ("v1").
        properties = "spring.mvc.apiversion.use.path-segment=1"
)
class ProfileControllerTest {

    /**
     * Supplies the JwtDecoder bean required by {@code oauth2ResourceServer(jwt())}
     * and replaces the production SecurityConfig (which depends on DB-backed beans).
     * Using {@code @TestConfiguration} lets Spring Boot's {@code @WebMvcTest} bootstrapper
     * auto-detect this inner class without an {@code @Import}, which would otherwise
     * promote it to the primary source class and prevent the controller from loading.
     */
    @TestConfiguration
    static class TestSecurityConfig {

        /** Never called — jwt() post-processor installs principal directly. */
        @Bean
        JwtDecoder jwtDecoder() {
            return mock(JwtDecoder.class);
        }

        @Bean
        SecurityFilterChain testSecurityFilterChain(HttpSecurity http) throws Exception {
            return http
                    .csrf(AbstractHttpConfigurer::disable)
                    .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
                    .oauth2ResourceServer(rs -> rs.jwt(jwtConfigurer -> {}))
                    .build();
        }
    }

    @Autowired
    MockMvcTester mvc;

    @MockitoBean
    ProfileService profileService;

    private static final UUID USER_ID = UUID.fromString("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    private ProfileResponse buildResponse(boolean githubConnected) {
        SourceStatus github = githubConnected
                ? new SourceStatus("GITHUB", true, java.time.Instant.parse("2026-06-05T12:00:00Z"))
                : new SourceStatus("GITHUB", false, null);

        List<SourceStatus> sources = List.of(
                github,
                new SourceStatus("RESUME",   false, null),
                new SourceStatus("LEETCODE", false, null),
                new SourceStatus("LINKEDIN", false, null),
                new SourceStatus("X",        false, null)
        );

        return new ProfileResponse(
                new ProfileUser("Aisha Verma", null),
                sources,
                List.of(new NotableItem("1,204 GitHub contributions in the last year", "GITHUB")),
                List.of(new SkillItem("TypeScript", "GitHub 48%")),
                List.of("Most active in TypeScript and Python across 38 repos"),
                Map.of(),
                List.of()
        );
    }

    /**
     * Verifies the controller extracts userId from the JWT subject claim, delegates to
     * {@link ProfileService#getProfile}, and returns the correct JSON shape.
     */
    @Test
    void getMe_extractsUserIdFromJwtSubjectAndReturnsProfileShape() {
        when(profileService.getProfile(USER_ID)).thenReturn(buildResponse(true));

        var response = mvc.get().uri("/api/v1/profile/me")
                .with(jwt().jwt(j -> j.subject(USER_ID.toString())))
                .exchange();

        assertThat(response)
                .hasStatusOk()
                .bodyJson()
                .hasPathSatisfying("$.user.name", name -> assertThat(name).isEqualTo("Aisha Verma"))
                .hasPathSatisfying("$.sources",   s    -> assertThat(s).isNotNull())
                .hasPathSatisfying("$.atAGlance", ag   -> assertThat(ag).isNotNull());
    }

    /**
     * Verifies that every unconnected source omits {@code lastRefreshedAt} from the JSON
     * output (governed by {@code @JsonInclude(NON_NULL)} on {@link SourceStatus}).
     */
    @Test
    void getMe_unconnectedSourcesHaveConnectedFalseAndNoLastRefreshedAt() throws Exception {
        when(profileService.getProfile(any(UUID.class))).thenReturn(buildResponse(false));

        var response = mvc.get().uri("/api/v1/profile/me")
                .with(jwt().jwt(j -> j.subject(USER_ID.toString())))
                .exchange();

        assertThat(response).hasStatusOk();

        ObjectMapper mapper = new ObjectMapper();
        String body = response.getResponse().getContentAsString();
        var root = mapper.readTree(body);
        var sources = root.get("sources");

        assertThat(sources).isNotNull();
        assertThat(sources.isArray()).isTrue();

        for (var sourceNode : sources) {
            boolean connected = sourceNode.get("connected").asBoolean();
            if (!connected) {
                assertThat(sourceNode.has("lastRefreshedAt"))
                        .as("Unconnected source '%s' must not include lastRefreshedAt",
                                sourceNode.get("source").asString())
                        .isFalse();
            }
        }
    }

    /** Verifies that a request without a Bearer JWT is rejected with 401. */
    @Test
    void getMe_withoutJwt_returns401() {
        var response = mvc.get().uri("/api/v1/profile/me").exchange();
        assertThat(response).hasStatus(401);
    }
}
