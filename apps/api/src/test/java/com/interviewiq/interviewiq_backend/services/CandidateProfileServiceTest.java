package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.ResumeParseRunResponse;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.repositories.CandidateProfileRepository;
import com.interviewiq.interviewiq_backend.repositories.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.web.client.HttpClientErrorException;
import tools.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The async parse poll mapping: a run snapshot → {status, profile?, error?} draft. */
class CandidateProfileServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private AiServiceClient aiServiceClient;
    private CandidateProfileService service;

    @BeforeEach
    void setUp() {
        aiServiceClient = mock(AiServiceClient.class);
        service = new CandidateProfileService(
                mock(CandidateProfileRepository.class), mock(UserRepository.class),
                aiServiceClient, objectMapper);
    }

    @Test
    void completedRun_mapsResultToDraftProfile() {
        String snap = """
            {"status":"completed","result":{
              "full_name":"Asha Rao","headline":null,
              "education":[{"institution":"IIT","degree":"B.Tech","field":"CS","start_year":"2021","end_year":"2025","grade":"8.9"}],
              "experience":[{"company":"Acme","title":"Intern","bullets":["Built X"]}],
              "projects":[{"name":"Relay","description":"Mac agent","tech":["Node.js"],"bullets":["72% fewer tokens"],"link":null}],
              "skills":["Python","SQL"],
              "achievements":["SIH 2024 finalist"],
              "links":{"github":"https://github.com/asha","leetcode":null,"linkedin":null}
            }}""";
        when(aiServiceClient.getResumeParseRun(eq("r1"), anyLong())).thenReturn(objectMapper.readTree(snap));

        ResumeParseRunResponse res = service.resumeParseRunStatus("r1");

        assertEquals("completed", res.status());
        assertNull(res.error());
        assertEquals("Asha Rao", res.profile().fullName());
        assertEquals(1, res.profile().projects().size());
        assertEquals("Relay", res.profile().projects().get(0).name());
        assertEquals(java.util.List.of("Node.js"), res.profile().projects().get(0).tech());
        assertEquals(java.util.List.of("SIH 2024 finalist"), res.profile().achievements());
        assertEquals("https://github.com/asha", res.profile().detectedLinks().github());
    }

    @Test
    void runningRun_hasNoProfile() {
        when(aiServiceClient.getResumeParseRun(eq("r1"), anyLong()))
                .thenReturn(objectMapper.readTree("{\"status\":\"running\"}"));
        ResumeParseRunResponse res = service.resumeParseRunStatus("r1");
        assertEquals("running", res.status());
        assertNull(res.profile());
    }

    @Test
    void failedRun_surfacesMessage() {
        when(aiServiceClient.getResumeParseRun(eq("r1"), anyLong()))
                .thenReturn(objectMapper.readTree(
                        "{\"status\":\"failed\",\"error\":{\"step\":\"llm_response\",\"message\":\"all keys cooling\"}}"));
        ResumeParseRunResponse res = service.resumeParseRunStatus("r1");
        assertEquals("failed", res.status());
        assertEquals("all keys cooling", res.error());
        assertNull(res.profile());
    }

    @Test
    void unknownRun_maps404ToFailedWithExpiryMessage() {
        when(aiServiceClient.getResumeParseRun(eq("gone"), anyLong())).thenThrow(
                HttpClientErrorException.create(org.springframework.http.HttpStatus.NOT_FOUND,
                        "Not Found", HttpHeaders.EMPTY, new byte[0], null));
        ResumeParseRunResponse res = service.resumeParseRunStatus("gone");
        assertEquals("failed", res.status());
        assertTrue(res.error().toLowerCase().contains("expired"));
    }
}
