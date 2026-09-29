package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.LiveSessionResponse;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.services.InterviewSessionService;
import com.interviewiq.interviewiq_backend.services.LiveSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(controllers = InterviewSessionController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1")
@Import(InterviewSessionControllerTest.TestSecurityConfig.class)
class InterviewSessionLiveControllerTest {

    private static final UUID USER = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired MockMvc mockMvc;
    @MockitoBean InterviewSessionService interviewSessionService; // controller ctor dep
    @MockitoBean LiveSessionService liveSessionService;
    // no @MockitoBean JwtDecoder here: the imported TestSecurityConfig already provides one

    @Test
    void goLive_returns200WithConnection() throws Exception {
        UUID sid = UUID.randomUUID();
        when(liveSessionService.startLive(eq(USER), eq(sid)))
                .thenReturn(new LiveSessionResponse("wss://x", "jwt", "interview-" + sid,
                        SessionStatus.LIVE_IN_PROGRESS));

        mockMvc.perform(post("/api/v1/interviews/sessions/" + sid + "/live")
                        .with(jwt().jwt(j -> j.subject(USER.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("jwt"))
                .andExpect(jsonPath("$.livekitUrl").value("wss://x"))
                .andExpect(jsonPath("$.status").value("LIVE_IN_PROGRESS"));
    }

    @Test
    void goLive_withoutJwt_isUnauthorized() throws Exception {
        mockMvc.perform(post("/api/v1/interviews/sessions/" + UUID.randomUUID() + "/live"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void getLive_returns200() throws Exception {
        UUID sid = UUID.randomUUID();
        when(liveSessionService.getLive(eq(USER), eq(sid)))
                .thenReturn(new LiveSessionResponse(null, null, null, SessionStatus.PREP_READY));

        mockMvc.perform(get("/api/v1/interviews/sessions/" + sid + "/live")
                        .with(jwt().jwt(j -> j.subject(USER.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PREP_READY"));
    }
}
