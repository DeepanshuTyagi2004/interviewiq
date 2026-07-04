package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.mock.web.MockMultipartFile;
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
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.security.config.Customizer.withDefaults;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
        controllers = AdminResumeParseController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1"
)
@Import(AdminResumeParseControllerTest.TestSecurityConfig.class)
class AdminResumeParseControllerTest {

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
    void startRun_forwardsBytes_andReturnsRunId() throws Exception {
        when(aiServiceClient.startResumeParseRun(any(), eq("resume.pdf")))
                .thenReturn(objectMapper.readTree("{\"run_id\":\"abc123\",\"status\":\"running\"}"));
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.pdf", "application/pdf", "%PDF-1.4 fake".getBytes());

        mockMvc.perform(multipart("/api/v1/intelligence/resume/parse/run").file(file).with(jwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.run_id").value("abc123"))
                .andExpect(jsonPath("$.status").value("running"));
    }

    @Test
    void startRun_nonPdf_isBadRequest() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.txt", "text/plain", "hello".getBytes());
        mockMvc.perform(multipart("/api/v1/intelligence/resume/parse/run").file(file).with(jwt()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("resume_bad_request"));
    }

    @Test
    void startRun_emptyFile_isBadRequest() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.pdf", "application/pdf", new byte[0]);
        mockMvc.perform(multipart("/api/v1/intelligence/resume/parse/run").file(file).with(jwt()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void runStatus_proxiesSnapshot() throws Exception {
        when(aiServiceClient.getResumeParseRun(eq("abc123"), anyLong()))
                .thenReturn(objectMapper.readTree("{\"run_id\":\"abc123\",\"status\":\"completed\",\"last_seq\":5}"));
        mockMvc.perform(get("/api/v1/intelligence/resume/parse/runs/abc123?after=2").with(jwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"))
                .andExpect(jsonPath("$.last_seq").value(5));
    }

    @Test
    void runStatus_unknownRun_maps404() throws Exception {
        when(aiServiceClient.getResumeParseRun(eq("nope"), anyLong()))
                .thenThrow(HttpClientErrorException.create(
                        NOT_FOUND, "Not Found", org.springframework.http.HttpHeaders.EMPTY, new byte[0], null));
        mockMvc.perform(get("/api/v1/intelligence/resume/parse/runs/nope").with(jwt()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("run_not_found"));
    }

    @Test
    void aiServiceDown_maps502() throws Exception {
        when(aiServiceClient.listResumeParseRuns()).thenThrow(new RestClientException("connection refused"));
        mockMvc.perform(get("/api/v1/intelligence/resume/parse/runs").with(jwt()))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("ai_service_unreachable"));
    }
}
