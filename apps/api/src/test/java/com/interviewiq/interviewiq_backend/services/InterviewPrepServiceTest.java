package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.CandidateProfileResponse;
import com.interviewiq.interviewiq_backend.dtos.EducationDto;
import com.interviewiq.interviewiq_backend.dtos.ExperienceDto;
import com.interviewiq.interviewiq_backend.dtos.ProjectDto;
import com.interviewiq.interviewiq_backend.dtos.ResumeLinksDto;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.models.RoundType;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class InterviewPrepServiceTest {

    @Mock InterviewSessionRepository sessionRepository;
    @Mock JobDescriptionRepository jdRepository;
    @Mock CandidateProfileService candidateProfileService;
    @Mock CodingSignalsProvider codingSignalsProvider;
    @Mock AiServiceClient aiServiceClient;

    InterviewPrepService prepService;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @BeforeEach
    void setUp() {
        // Tiny poll interval + generous wait so fire-and-poll tests don't actually sleep long.
        prepService = new InterviewPrepService(sessionRepository, jdRepository, candidateProfileService,
                codingSignalsProvider, aiServiceClient, 1L, 2000L);
    }

    private JobDescription jd() {
        JobDescription jd = new JobDescription("google", "software-engineer", "sde1", "SWE",
                "backend", "Build things", "Java, Spring", "http://jd", "seed");
        jd.setId(UUID.randomUUID());
        return jd;
    }

    private InterviewSession session(JobDescription jd) {
        InterviewSession s = new InterviewSession(UUID.randomUUID(), jd, RoundType.DSA,
                Instant.parse("2026-07-10T10:00:00Z"), "Asia/Kolkata");
        s.setId(UUID.randomUUID());
        return s;
    }

    private CandidateProfileResponse profile() {
        return new CandidateProfileResponse(
                "Asha Rao", "asha@example.com", null, "Delhi", "Aspiring SDE", "SDE",
                List.of(new EducationDto("IIT", "B.Tech", "CS", "2021", "2025", "8.9")),
                List.of(new ExperienceDto("Acme", "Intern", "2024", "2024", "Remote", List.of("Built X"))),
                List.of(new ProjectDto("Relay", "Mac automation agent", List.of("Node.js"),
                        List.of("Built a real-time automation agent"), null)),
                List.of("Python"),
                List.of("Smart India Hackathon 2024 finalist"),
                new ResumeLinksDto("https://github.com/asha", null, null),
                "resume.pdf", null, true);
    }

    private void stubCommon(InterviewSession s, JobDescription jd) {
        when(sessionRepository.findById(s.getId())).thenReturn(Optional.of(s));
        when(jdRepository.findById(jd.getId())).thenReturn(Optional.of(jd));
        when(sessionRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void generatePrep_success_marksReadyWithPlanRef() {
        JobDescription jd = jd();
        InterviewSession s = session(jd);
        stubCommon(s, jd);
        when(candidateProfileService.getProfile(s.getCandidateId())).thenReturn(Optional.of(profile()));
        when(aiServiceClient.startInterviewPlan(any())).thenReturn("run1");
        when(aiServiceClient.getInterviewPlanRun(any())).thenReturn(MAPPER.readTree(
                "{\"status\":\"completed\",\"plan\":{\"provenance\":{\"planVersion\":\"v1\",\"inputHash\":\"sha256:abc\"}}}"));

        prepService.generatePrep(s.getId());

        assertEquals(SessionStatus.PREP_READY, s.getStatus());
        assertEquals("v1", s.getPlanVersion());
        assertEquals("sha256:abc", s.getInputHash());
        assertNull(s.getPrepError());
    }

    @Test
    void generatePrep_assemblesBodyFromSessionJdAndProfile() {
        JobDescription jd = jd();
        InterviewSession s = session(jd);
        stubCommon(s, jd);
        when(candidateProfileService.getProfile(s.getCandidateId())).thenReturn(Optional.of(profile()));
        when(aiServiceClient.startInterviewPlan(any())).thenReturn("run1");
        when(aiServiceClient.getInterviewPlanRun(any())).thenReturn(
                MAPPER.readTree("{\"status\":\"completed\",\"plan\":{\"provenance\":{}}}"));

        prepService.generatePrep(s.getId());

        ArgumentCaptor<GenerateInterviewPlanRequest> cap =
                ArgumentCaptor.forClass(GenerateInterviewPlanRequest.class);
        verify(aiServiceClient).startInterviewPlan(cap.capture());
        GenerateInterviewPlanRequest body = cap.getValue();

        assertEquals(s.getId(), body.session().sessionId());
        assertEquals(s.getCandidateId(), body.session().candidateId());
        assertEquals("google", body.session().company());
        assertEquals("software-engineer", body.session().role());
        assertEquals("sde1", body.session().level());
        assertEquals("backend", body.session().specialization());
        assertEquals(RoundType.DSA, body.session().roundType());

        assertEquals(jd.getId(), body.jobDescription().id());
        assertEquals("SWE", body.jobDescription().title());
        assertEquals("Java, Spring", body.jobDescription().techStack());

        assertEquals("Asha Rao", body.candidateProfile().fullName());
        assertEquals(List.of("Python"), body.candidateProfile().skills());
        assertEquals("https://github.com/asha", body.candidateProfile().links().github());
    }

    @Test
    void generatePrep_missingProfile_stillBuildsBody() {
        JobDescription jd = jd();
        InterviewSession s = session(jd);
        stubCommon(s, jd);
        when(candidateProfileService.getProfile(s.getCandidateId())).thenReturn(Optional.empty());
        when(aiServiceClient.startInterviewPlan(any())).thenReturn("run1");
        when(aiServiceClient.getInterviewPlanRun(any())).thenReturn(
                MAPPER.readTree("{\"status\":\"completed\",\"plan\":{\"provenance\":{}}}"));

        prepService.generatePrep(s.getId());

        ArgumentCaptor<GenerateInterviewPlanRequest> cap =
                ArgumentCaptor.forClass(GenerateInterviewPlanRequest.class);
        verify(aiServiceClient).startInterviewPlan(cap.capture());
        assertNull(cap.getValue().candidateProfile().fullName());
        assertTrue(cap.getValue().candidateProfile().skills().isEmpty());
        assertEquals(SessionStatus.PREP_READY, s.getStatus());
    }

    @Test
    void generatePrep_upstreamFailure_marksFailed() {
        JobDescription jd = jd();
        InterviewSession s = session(jd);
        stubCommon(s, jd);
        when(candidateProfileService.getProfile(any())).thenReturn(Optional.empty());
        when(aiServiceClient.startInterviewPlan(any())).thenThrow(new RestClientException("ai-service down"));

        prepService.generatePrep(s.getId());

        assertEquals(SessionStatus.PREP_FAILED, s.getStatus());
        assertNotNull(s.getPrepError());
    }

    @Test
    void generatePrep_runReportsFailed_marksFailedWithCode() {
        JobDescription jd = jd();
        InterviewSession s = session(jd);
        stubCommon(s, jd);
        when(candidateProfileService.getProfile(any())).thenReturn(Optional.empty());
        when(aiServiceClient.startInterviewPlan(any())).thenReturn("run1");
        when(aiServiceClient.getInterviewPlanRun(any())).thenReturn(MAPPER.readTree(
                "{\"status\":\"failed\",\"error\":{\"code\":\"llm_error\",\"message\":\"model never valid\"}}"));

        prepService.generatePrep(s.getId());

        assertEquals(SessionStatus.PREP_FAILED, s.getStatus());
        assertEquals("prep_generation_llm_error", s.getPrepError());
    }

    @Test
    void generatePrep_missingSession_isNoop() {
        UUID missing = UUID.randomUUID();
        when(sessionRepository.findById(missing)).thenReturn(Optional.empty());

        prepService.generatePrep(missing);

        verifyNoInteractions(aiServiceClient);
        verify(sessionRepository, never()).save(any());
    }
}
