package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.*;
import com.interviewiq.interviewiq_backend.services.CandidateProfileService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.HttpClientErrorException;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.config.Customizer.withDefaults;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
        controllers = CandidateProfileController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1"
)
@Import(CandidateProfileControllerTest.TestSecurityConfig.class)
class CandidateProfileControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    CandidateProfileService service;

    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @TestConfiguration
    @EnableWebSecurity
    static class TestSecurityConfig {
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

    private CandidateProfileResponse sample(boolean onboardingComplete) {
        return new CandidateProfileResponse(
                "Asha Rao", "asha@example.com", "+91 90000 00000", "Delhi", "Aspiring SDE", "SDE",
                List.of(new EducationDto("IIT", "B.Tech", "CS", "2021", "2025", "8.9")),
                List.of(new ExperienceDto("Acme", "Intern", "2024", "2024", "Remote", List.of("Built X"))),
                List.of(new ProjectDto("Relay", "Mac automation agent", List.of("Node.js", "WebSocket"),
                        List.of("Built a real-time automation agent"), "https://github.com/asha/relay")),
                List.of("Python", "SQL"),
                List.of("Smart India Hackathon 2024 finalist"),
                new ResumeLinksDto("https://github.com/asha", null, null),
                "resume.pdf", null, onboardingComplete);
    }

    @Test
    void parseResume_returnsDraft() throws Exception {
        when(service.parseResume(any(), any())).thenReturn(sample(false));
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.pdf", "application/pdf", "%PDF-1.4 fake".getBytes());

        mockMvc.perform(multipart("/api/v1/users/me/resume/parse").file(file)
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fullName").value("Asha Rao"))
                .andExpect(jsonPath("$.education[0].institution").value("IIT"))
                .andExpect(jsonPath("$.experience[0].bullets[0]").value("Built X"))
                .andExpect(jsonPath("$.skills[0]").value("Python"))
                .andExpect(jsonPath("$.detectedLinks.github").value("https://github.com/asha"))
                .andExpect(jsonPath("$.onboardingComplete").value(false));
    }

    @Test
    void parseResume_nonPdf_isBadRequest() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.txt", "text/plain", "hello".getBytes());

        mockMvc.perform(multipart("/api/v1/users/me/resume/parse").file(file)
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("resume_bad_request"));
    }

    @Test
    void parseResume_unreadablePdf_maps422() throws Exception {
        when(service.parseResume(any(), any())).thenThrow(
                HttpClientErrorException.create(HttpStatusCode.valueOf(422), "Unprocessable",
                        HttpHeaders.EMPTY, null, null));
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.pdf", "application/pdf", "%PDF-1.4 scanned".getBytes());

        mockMvc.perform(multipart("/api/v1/users/me/resume/parse").file(file)
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().is(422))
                .andExpect(jsonPath("$.code").value("resume_unreadable"));
    }

    @Test
    void getCandidateProfile_returnsProfile() throws Exception {
        when(service.getProfile(USER_ID)).thenReturn(Optional.of(sample(true)));

        mockMvc.perform(get("/api/v1/users/me/candidate-profile")
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fullName").value("Asha Rao"))
                .andExpect(jsonPath("$.onboardingComplete").value(true))
                // hard rule: descriptive only, no scoring
                .andExpect(jsonPath("$.score").doesNotExist());
    }

    @Test
    void getCandidateProfile_whenNone_returnsNoContent() throws Exception {
        when(service.getProfile(USER_ID)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/v1/users/me/candidate-profile")
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isNoContent());
    }

    @Test
    void saveCandidateProfile_returnsSaved() throws Exception {
        when(service.saveProfile(eq(USER_ID), any())).thenReturn(sample(true));
        String body = new ObjectMapper().writeValueAsString(new CandidateProfileRequest(
                "Asha Rao", "asha@example.com", null, "Delhi", null, "SDE",
                List.of(), List.of(), List.of(), List.of("Python"), List.of(),
                new ResumeLinksDto(null, null, null), "resume.pdf", true));

        mockMvc.perform(put("/api/v1/users/me/candidate-profile")
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString())))
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.onboardingComplete").value(true));
    }

    @Test
    void getCandidateProfile_withoutJwt_isUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/users/me/candidate-profile"))
                .andExpect(status().isUnauthorized());
    }
}
