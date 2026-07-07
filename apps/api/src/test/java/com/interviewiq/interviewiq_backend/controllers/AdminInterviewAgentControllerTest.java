package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.ObjectMapper;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
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
        controllers = AdminInterviewAgentController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1"
)
@Import(AdminInterviewAgentControllerTest.TestSecurityConfig.class)
class AdminInterviewAgentControllerTest {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @MockitoBean
    AiServiceClient aiServiceClient;

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

    @Test
    void start_run_proxies_and_returns_body() throws Exception {
        when(aiServiceClient.startAgentRun(any()))
                .thenReturn(objectMapper.readTree("{\"run_id\":\"r1\",\"status\":\"running\"}"));

        mockMvc.perform(post("/api/v1/intelligence/interview-agent/run")
                        .with(jwt())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.run_id").value("r1"));
    }

    @Test
    void unknown_run_maps_to_404_run_not_found() throws Exception {
        when(aiServiceClient.getAgentRun(eq("nope"), anyLong()))
                .thenThrow(HttpClientErrorException.create(HttpStatus.NOT_FOUND, "nf", null, null, null));

        mockMvc.perform(get("/api/v1/intelligence/interview-agent/runs/nope").with(jwt()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("run_not_found"));
    }

    @Test
    void aiservice_down_maps_to_502() throws Exception {
        when(aiServiceClient.listAgentRuns()).thenThrow(new RestClientException("down"));

        mockMvc.perform(get("/api/v1/intelligence/interview-agent/runs").with(jwt()))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("ai_service_unreachable"));
    }
}
