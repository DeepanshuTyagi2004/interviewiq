package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest;
import com.interviewiq.interviewiq_backend.models.CandidateProfile;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.repositories.CandidateProfileRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import com.interviewiq.interviewiq_backend.repositories.UserRepository;
import com.interviewiq.interviewiq_backend.services.CandidateProfileService;
import com.interviewiq.interviewiq_backend.services.CodingSignalsProvider;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.ObjectMapper;

import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.security.config.Customizer.withDefaults;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(
        controllers = AdminInterviewPrepController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1"
)
@Import(AdminInterviewPrepControllerTest.TestSecurityConfig.class)
class AdminInterviewPrepControllerTest {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper objectMapper;

    @MockitoBean
    JobDescriptionRepository jdRepository;

    @MockitoBean
    CandidateProfileService candidateProfileService;

    @MockitoBean
    CandidateProfileRepository candidateProfileRepository;

    @MockitoBean
    UserRepository userRepository;

    @MockitoBean
    CodingSignalsProvider codingSignalsProvider;

    @MockitoBean
    AiServiceClient aiServiceClient;

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

    private JobDescription realJd() {
        JobDescription jd = new JobDescription(
                "acme", "software-engineer", "sde1", "SDE 1",
                "backend", "Build things", "Java, Spring", null, "seed");
        jd.setId(JD_ID);
        return jd;
    }

    @Test
    void startRun_assemblesAndForwards() throws Exception {
        when(jdRepository.findById(JD_ID)).thenReturn(Optional.of(realJd()));
        when(aiServiceClient.startInterviewPrepRun(any(GenerateInterviewPlanRequest.class)))
                .thenReturn(objectMapper.readTree("{\"run_id\":\"prep-1\",\"status\":\"running\"}"));

        mockMvc.perform(post("/api/v1/intelligence/interview-prep/run")
                        .with(jwt())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"jobDescriptionId\":\"" + JD_ID + "\",\"roundType\":\"dsa\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.run_id").value("prep-1"));
    }

    @Test
    void startRun_defaultsRoundWhenOmitted() throws Exception {
        when(jdRepository.findById(JD_ID)).thenReturn(Optional.of(realJd()));
        when(aiServiceClient.startInterviewPrepRun(any(GenerateInterviewPlanRequest.class)))
                .thenReturn(objectMapper.readTree("{\"run_id\":\"prep-2\",\"status\":\"running\"}"));

        // No roundType in the body — the bench, like the real flow, defaults to the first round.
        mockMvc.perform(post("/api/v1/intelligence/interview-prep/run")
                        .with(jwt())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"jobDescriptionId\":\"" + JD_ID + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.run_id").value("prep-2"));
    }

    @Test
    void startRun_unknownJd_isBadRequest() throws Exception {
        when(jdRepository.findById(JD_ID)).thenReturn(Optional.empty());
        mockMvc.perform(post("/api/v1/intelligence/interview-prep/run")
                        .with(jwt())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"jobDescriptionId\":\"" + JD_ID + "\",\"roundType\":\"dsa\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void runStatus_proxies() throws Exception {
        when(aiServiceClient.getInterviewPrepRun(org.mockito.ArgumentMatchers.eq("prep-1"),
                org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(objectMapper.readTree("{\"run_id\":\"prep-1\",\"status\":\"completed\"}"));
        mockMvc.perform(get("/api/v1/intelligence/interview-prep/runs/prep-1").with(jwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"));
    }

    @Test
    void candidates_listsOnboardedCandidatesWithNameAndEmail() throws Exception {
        UUID uid = UUID.fromString("55555555-5555-5555-5555-555555555555");
        CandidateProfile profile = new CandidateProfile(uid);
        profile.setFullName("Asha Rao");
        User user = new User("gsub-1", "asha@example.com", "Asha Rao");
        user.setId(uid);
        when(candidateProfileRepository.findAll()).thenReturn(java.util.List.of(profile));
        when(userRepository.findAllById(any())).thenReturn(java.util.List.of(user));

        mockMvc.perform(get("/api/v1/intelligence/interview-prep/candidates").with(jwt()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(uid.toString()))
                .andExpect(jsonPath("$[0].name").value("Asha Rao"))
                .andExpect(jsonPath("$[0].email").value("asha@example.com"));
    }

    @Test
    void aiServiceDown_maps502() throws Exception {
        when(aiServiceClient.listInterviewPrepRuns()).thenThrow(new RestClientException("refused"));
        mockMvc.perform(get("/api/v1/intelligence/interview-prep/runs").with(jwt()))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("ai_service_unreachable"));
    }
}
