package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.InterviewSessionListResponse;
import com.interviewiq.interviewiq_backend.dtos.InterviewSessionResponse;
import com.interviewiq.interviewiq_backend.models.RoundType;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.services.InterviewSessionException;
import com.interviewiq.interviewiq_backend.services.InterviewSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.config.Customizer.withDefaults;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
        controllers = InterviewSessionController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1"
)
@Import(InterviewSessionControllerTest.TestSecurityConfig.class)
class InterviewSessionControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    InterviewSessionService service;

    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID SESSION_ID = UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID JD_ID = UUID.fromString("33333333-3333-3333-3333-333333333333");

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

    private InterviewSessionResponse sample(SessionStatus status) {
        return new InterviewSessionResponse(
                SESSION_ID, USER_ID, JD_ID, "google", "Google", "software-engineer", "sde1", "backend",
                RoundType.DSA, Instant.parse("2026-07-10T10:00:00Z"), "Asia/Kolkata", status,
                status == SessionStatus.PREP_READY, null, null, null,
                Instant.parse("2026-07-01T00:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"));
    }

    private String createBody() {
        return """
                {"jobDescriptionId":"%s","roundType":"dsa","scheduledAt":"2026-07-10T10:00:00Z","timezone":"Asia/Kolkata"}
                """.formatted(JD_ID);
    }

    @Test
    void createSession_returns201WithWireShape() throws Exception {
        when(service.createSession(eq(USER_ID), any())).thenReturn(sample(SessionStatus.SCHEDULED));

        mockMvc.perform(post("/api/v1/interviews/sessions")
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString())))
                        .contentType("application/json")
                        .content(createBody()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("SCHEDULED"))
                .andExpect(jsonPath("$.roundType").value("dsa"))       // wire value, not enum name
                .andExpect(jsonPath("$.companyName").value("Google"))
                .andExpect(jsonPath("$.planReady").value(false));
    }

    @Test
    void listSessions_returnsList() throws Exception {
        when(service.listSessions(USER_ID)).thenReturn(
                new InterviewSessionListResponse(List.of(sample(SessionStatus.PREP_READY))));

        mockMvc.perform(get("/api/v1/interviews/sessions")
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessions[0].status").value("PREP_READY"))
                .andExpect(jsonPath("$.sessions[0].planReady").value(true));
    }

    @Test
    void getSession_returnsSession() throws Exception {
        when(service.getSession(USER_ID, SESSION_ID)).thenReturn(sample(SessionStatus.PREP_QUEUED));

        mockMvc.perform(get("/api/v1/interviews/sessions/{id}", SESSION_ID)
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PREP_QUEUED"))
                // hard rule: descriptive only — no scoring on the session view
                .andExpect(jsonPath("$.score").doesNotExist())
                .andExpect(jsonPath("$.rating").doesNotExist());
    }

    @Test
    void regenerate_returns202() throws Exception {
        when(service.regenerate(USER_ID, SESSION_ID)).thenReturn(sample(SessionStatus.PREP_QUEUED));

        mockMvc.perform(post("/api/v1/interviews/sessions/{id}/regenerate", SESSION_ID)
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("PREP_QUEUED"));
    }

    @Test
    void createSession_jdNotFound_maps400WithCode() throws Exception {
        when(service.createSession(eq(USER_ID), any())).thenThrow(
                new InterviewSessionException(HttpStatus.BAD_REQUEST, "session_jd_not_found", "job description not found"));

        mockMvc.perform(post("/api/v1/interviews/sessions")
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString())))
                        .contentType("application/json")
                        .content(createBody()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("session_jd_not_found"));
    }

    @Test
    void getSession_notFound_maps404() throws Exception {
        when(service.getSession(USER_ID, SESSION_ID)).thenThrow(InterviewSessionException.notFound());

        mockMvc.perform(get("/api/v1/interviews/sessions/{id}", SESSION_ID)
                        .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("session_not_found"));
    }

    @Test
    void listSessions_withoutJwt_isUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/interviews/sessions"))
                .andExpect(status().isUnauthorized());
    }
}
