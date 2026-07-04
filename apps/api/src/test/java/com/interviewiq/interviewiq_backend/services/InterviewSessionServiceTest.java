package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.CreateInterviewSessionRequest;
import com.interviewiq.interviewiq_backend.dtos.InterviewSessionResponse;
import com.interviewiq.interviewiq_backend.models.CompanyRoleConfig;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.models.RoundType;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.CompanyRepository;
import com.interviewiq.interviewiq_backend.repositories.CompanyRoleConfigRepository;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class InterviewSessionServiceTest {

    @Mock InterviewSessionRepository sessionRepository;
    @Mock JobDescriptionRepository jdRepository;
    @Mock CompanyRoleConfigRepository configRepository;
    @Mock CompanyRepository companyRepository;
    @Mock InterviewPrepService prepService;

    @InjectMocks InterviewSessionService service;

    private static final UUID USER = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private JobDescription jd() {
        JobDescription jd = new JobDescription("google", "software-engineer", "sde1", "SWE",
                "backend", "Build things", "Java, Spring", "http://jd", "seed");
        jd.setId(UUID.randomUUID());
        return jd;
    }

    private CompanyRoleConfig enabledConfig() {
        CompanyRoleConfig c = new CompanyRoleConfig("google", "software-engineer", "sde1");
        c.setEnabled(true);
        return c;
    }

    private CreateInterviewSessionRequest req(UUID jdId) {
        return new CreateInterviewSessionRequest(
                jdId, RoundType.DSA, Instant.parse("2026-07-10T10:00:00Z"), "Asia/Kolkata");
    }

    private InterviewSession existing(SessionStatus status) {
        InterviewSession s = new InterviewSession(USER, jd(), RoundType.DSA,
                Instant.parse("2026-07-10T10:00:00Z"), "Asia/Kolkata");
        s.setId(UUID.randomUUID());
        s.setStatus(status);
        return s;
    }

    @Test
    void createSession_happy_isScheduledAndCopiesJdKey() {
        JobDescription jd = jd();
        when(jdRepository.findById(jd.getId())).thenReturn(Optional.of(jd));
        when(configRepository.findByCompanyAndRoleAndLevel("google", "software-engineer", "sde1"))
                .thenReturn(Optional.of(enabledConfig()));
        when(sessionRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(companyRepository.findBySlug("google")).thenReturn(Optional.empty());

        InterviewSessionResponse resp = service.createSession(USER, req(jd.getId()));

        assertEquals(SessionStatus.SCHEDULED, resp.status());
        assertEquals("google", resp.company());
        assertEquals("sde1", resp.level());
        assertEquals("backend", resp.specialization());
        assertEquals(RoundType.DSA, resp.roundType());
        assertEquals("Asia/Kolkata", resp.timezone());
        assertFalse(resp.planReady());

        ArgumentCaptor<InterviewSession> cap = ArgumentCaptor.forClass(InterviewSession.class);
        verify(sessionRepository).save(cap.capture());
        assertEquals(USER, cap.getValue().getCandidateId());
        assertEquals(jd.getId(), cap.getValue().getJobDescriptionId());
        assertEquals(SessionStatus.SCHEDULED, cap.getValue().getStatus());
        verifyNoInteractions(prepService);
    }

    @Test
    void createSession_defaultsToFirstRound_whenRoundOmitted() {
        JobDescription jd = jd();
        when(jdRepository.findById(jd.getId())).thenReturn(Optional.of(jd));
        when(configRepository.findByCompanyAndRoleAndLevel("google", "software-engineer", "sde1"))
                .thenReturn(Optional.of(enabledConfig()));
        when(sessionRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(companyRepository.findBySlug("google")).thenReturn(Optional.empty());

        // The candidate does not pick the round — omitting it must assign the default (first round).
        CreateInterviewSessionRequest noRound = new CreateInterviewSessionRequest(
                jd.getId(), null, Instant.parse("2026-07-10T10:00:00Z"), "Asia/Kolkata");
        InterviewSessionResponse resp = service.createSession(USER, noRound);

        assertEquals(RoundType.DEFAULT, resp.roundType());
        assertEquals(RoundType.DSA, resp.roundType());
    }

    @Test
    void createSession_jdNotFound_throws() {
        UUID jdId = UUID.randomUUID();
        when(jdRepository.findById(jdId)).thenReturn(Optional.empty());

        InterviewSessionException ex = assertThrows(InterviewSessionException.class,
                () -> service.createSession(USER, req(jdId)));
        assertEquals("session_jd_not_found", ex.code());
        assertEquals(HttpStatus.BAD_REQUEST, ex.status());
        verify(sessionRepository, never()).save(any());
    }

    @Test
    void createSession_noCompanyRoleConfig_throws() {
        JobDescription jd = jd();
        when(jdRepository.findById(jd.getId())).thenReturn(Optional.of(jd));
        when(configRepository.findByCompanyAndRoleAndLevel(any(), any(), any())).thenReturn(Optional.empty());

        InterviewSessionException ex = assertThrows(InterviewSessionException.class,
                () -> service.createSession(USER, req(jd.getId())));
        assertEquals("session_role_not_configured", ex.code());
        verify(sessionRepository, never()).save(any());
    }

    @Test
    void createSession_disabledConfig_throws() {
        JobDescription jd = jd();
        CompanyRoleConfig disabled = enabledConfig();
        disabled.setEnabled(false);
        when(jdRepository.findById(jd.getId())).thenReturn(Optional.of(jd));
        when(configRepository.findByCompanyAndRoleAndLevel(any(), any(), any())).thenReturn(Optional.of(disabled));

        InterviewSessionException ex = assertThrows(InterviewSessionException.class,
                () -> service.createSession(USER, req(jd.getId())));
        assertEquals("session_role_disabled", ex.code());
    }

    @Test
    void createSession_blankTimezone_throwsBeforeTouchingRepos() {
        CreateInterviewSessionRequest bad = new CreateInterviewSessionRequest(
                UUID.randomUUID(), RoundType.DSA, Instant.now(), "   ");
        InterviewSessionException ex = assertThrows(InterviewSessionException.class,
                () -> service.createSession(USER, bad));
        assertEquals("session_timezone_required", ex.code());
        verifyNoInteractions(jdRepository, sessionRepository);
    }

    @Test
    void createSession_pastSlot_throws() {
        CreateInterviewSessionRequest past = new CreateInterviewSessionRequest(
                UUID.randomUUID(), RoundType.DSA, Instant.parse("2020-01-01T00:00:00Z"), "Asia/Kolkata");
        InterviewSessionException ex = assertThrows(InterviewSessionException.class,
                () -> service.createSession(USER, past));
        assertEquals("session_slot_in_past", ex.code());
        verifyNoInteractions(jdRepository, sessionRepository);
    }

    @Test
    void getSession_notOwned_throwsNotFound() {
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.empty());

        InterviewSessionException ex = assertThrows(InterviewSessionException.class,
                () -> service.getSession(USER, sid));
        assertEquals("session_not_found", ex.code());
        assertEquals(HttpStatus.NOT_FOUND, ex.status());
    }

    @Test
    void regenerate_movesToQueuedAndTriggersPrep() {
        InterviewSession s = existing(SessionStatus.PREP_FAILED);
        s.setPrepError("prep_generation_failed");
        when(sessionRepository.findByIdAndCandidateId(s.getId(), USER)).thenReturn(Optional.of(s));
        when(sessionRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(companyRepository.findBySlug(any())).thenReturn(Optional.empty());

        InterviewSessionResponse resp = service.regenerate(USER, s.getId());

        assertEquals(SessionStatus.PREP_QUEUED, resp.status());
        assertNull(resp.prepError());
        verify(prepService).generateAsync(s.getId());
    }

    @Test
    void listSessions_mapsAll() {
        when(sessionRepository.findAllByCandidateIdOrderByScheduledAtDesc(USER))
                .thenReturn(List.of(existing(SessionStatus.SCHEDULED), existing(SessionStatus.PREP_READY)));
        when(companyRepository.findBySlug(any())).thenReturn(Optional.empty());

        assertEquals(2, service.listSessions(USER).sessions().size());
    }
}
