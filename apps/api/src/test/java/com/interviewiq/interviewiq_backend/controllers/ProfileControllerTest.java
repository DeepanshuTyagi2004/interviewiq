package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.services.ProfileService;
import com.interviewiq.interviewiq_backend.dtos.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

import static org.mockito.Mockito.mock;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.Mockito.when;
import static org.springframework.security.config.Customizer.withDefaults;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(
        controllers = ProfileController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1"
)
@Import(ProfileControllerTest.TestSecurityConfig.class)
class ProfileControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    ProfileService profileService;

    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @TestConfiguration
    @EnableWebSecurity
    static class TestSecurityConfig {

        /** Never called — jwt() post-processor installs principal directly. */
        @Bean
        JwtDecoder jwtDecoder() {
            return mock(JwtDecoder.class);
        }

        @Bean
        SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
            return http
                    .csrf(c -> c.disable())
                    .authorizeHttpRequests(a -> a.anyRequest().authenticated())
                    .oauth2ResourceServer(rs -> rs.jwt(withDefaults()))
                    .build();
        }
    }

    private ProfileResponse sampleResponse() {
        ObjectMapper om = new ObjectMapper();
        return new ProfileResponse(
                new ProfileUser("Aisha Verma", null),
                List.of(
                        new SourceStatus("GITHUB", true, Instant.parse("2026-06-01T00:00:00Z"), null),
                        new SourceStatus("RESUME", false, null, null),
                        new SourceStatus("LEETCODE", true, Instant.parse("2026-06-02T00:00:00Z"), "SYNCED"),
                        new SourceStatus("LINKEDIN", false, null, null),
                        new SourceStatus("X", false, null, null)),
                List.of(new NotableItem("1,204 GitHub contributions in the last year", "GITHUB")),
                List.of(new SkillItem("TypeScript", "GitHub 48%", "GITHUB")),
                List.of("Most active in TypeScript and Python across 38 repos"),
                Map.of("github", om.readTree("{\"login\":\"aishav\",\"publicRepos\":38}")),
                List.of(new ProvenanceItem("GITHUB", "sha256:abc", Instant.parse("2026-06-01T00:00:00Z"))));
    }

    @Test
    void me_returnsConsolidatedProfileShape() throws Exception {
        when(profileService.getProfile(USER_ID)).thenReturn(sampleResponse());

        mockMvc.perform(get("/api/v1/profile/me")
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.name").value("Aisha Verma"))
                .andExpect(jsonPath("$.user.headline").doesNotExist())
                .andExpect(jsonPath("$.sources[0].source").value("GITHUB"))
                .andExpect(jsonPath("$.sources[0].connected").value(true))
                .andExpect(jsonPath("$.sources[1].source").value("RESUME"))
                .andExpect(jsonPath("$.sources[1].connected").value(false))
                .andExpect(jsonPath("$.sources[1].lastRefreshedAt").doesNotExist())
                .andExpect(jsonPath("$.notable[0].text").value("1,204 GitHub contributions in the last year"))
                .andExpect(jsonPath("$.notable[0].source").value("GITHUB"))
                .andExpect(jsonPath("$.mostUsedSkills[0].skill").value("TypeScript"))
                .andExpect(jsonPath("$.mostUsedSkills[0].evidence").value("GitHub 48%"))
                .andExpect(jsonPath("$.atAGlance[0]").value("Most active in TypeScript and Python across 38 repos"))
                .andExpect(jsonPath("$.fragments.github.publicRepos").value(38))
                .andExpect(jsonPath("$.provenance[0].fragmentHash").value("sha256:abc"))
                // hard rule: no scoring anywhere
                .andExpect(jsonPath("$.score").doesNotExist())
                .andExpect(jsonPath("$.rank").doesNotExist());
    }

    @Test
    void me_withoutJwt_isUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/profile/me"))
                .andExpect(status().isUnauthorized());
    }
}
