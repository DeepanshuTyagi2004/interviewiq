package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.services.LiveSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = InternalLiveSessionController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1")
@Import(InternalLiveSessionControllerTest.TestSecurityConfig.class)
@TestPropertySource(properties = "internal.api-key=secret-key")
class InternalLiveSessionControllerTest {

    @Autowired MockMvc mockMvc;
    @MockitoBean LiveSessionService liveSessionService;
    @MockitoBean JwtDecoder jwtDecoder;

    private static final String BODY = "{\"ended_reason\":\"natural_complete\"}";

    @TestConfiguration
    @EnableWebSecurity
    static class TestSecurityConfig {
        @Bean
        SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
            return http
                    .csrf(c -> c.disable())
                    .authorizeHttpRequests(a -> a.anyRequest().permitAll())
                    .build();
        }
    }

    @Test
    void outcome_withValidKey_persistsAndReturns204() throws Exception {
        UUID sid = UUID.randomUUID();
        mockMvc.perform(post("/api/v1/internal/sessions/" + sid + "/outcome")
                        .header("X-Internal-Api-Key", "secret-key")
                        .contentType("application/json").content(BODY))
                .andExpect(status().isNoContent());
        verify(liveSessionService).recordOutcome(eq(sid), any());
    }

    @Test
    void outcome_withBadKey_is401_andDoesNotPersist() throws Exception {
        UUID sid = UUID.randomUUID();
        mockMvc.perform(post("/api/v1/internal/sessions/" + sid + "/outcome")
                        .header("X-Internal-Api-Key", "wrong")
                        .contentType("application/json").content(BODY))
                .andExpect(status().isUnauthorized());
        verify(liveSessionService, never()).recordOutcome(any(), any());
    }
}
