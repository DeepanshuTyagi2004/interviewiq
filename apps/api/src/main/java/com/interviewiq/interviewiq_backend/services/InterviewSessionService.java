package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.CreateInterviewSessionRequest;
import com.interviewiq.interviewiq_backend.dtos.InterviewSessionListResponse;
import com.interviewiq.interviewiq_backend.dtos.InterviewSessionResponse;
import com.interviewiq.interviewiq_backend.models.Company;
import com.interviewiq.interviewiq_backend.models.CompanyRoleConfig;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.models.RoundType;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.CompanyRepository;
import com.interviewiq.interviewiq_backend.repositories.CompanyRoleConfigRepository;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Interview session booking + read (Pipeline 1). Creating a session validates that the JD resolves
 * to a real, enabled company/role/level ({@link CompanyRoleConfig}) and a valid round, copies the
 * brief key onto the session, and leaves it {@code SCHEDULED} — the scheduled trigger builds the
 * prep plan later. {@code regenerate} re-queues prep on demand (safe: the ai-service caches on the
 * input hash).
 */
@Service
public class InterviewSessionService {

    private final InterviewSessionRepository sessionRepository;
    private final JobDescriptionRepository jdRepository;
    private final CompanyRoleConfigRepository configRepository;
    private final CompanyRepository companyRepository;
    private final InterviewPrepService prepService;

    public InterviewSessionService(
            InterviewSessionRepository sessionRepository,
            JobDescriptionRepository jdRepository,
            CompanyRoleConfigRepository configRepository,
            CompanyRepository companyRepository,
            InterviewPrepService prepService) {
        this.sessionRepository = sessionRepository;
        this.jdRepository = jdRepository;
        this.configRepository = configRepository;
        this.companyRepository = companyRepository;
        this.prepService = prepService;
    }

    @Transactional
    public InterviewSessionResponse createSession(UUID candidateId, CreateInterviewSessionRequest req) {
        if (req.jobDescriptionId() == null) {
            throw InterviewSessionException.badRequest("session_jd_required", "jobDescriptionId is required");
        }
        // The candidate does not pick the round — the platform decides it. For now every booking
        // starts on the first round; per-candidate round progression comes later. A round sent by a
        // trusted caller (e.g. the admin bench) is still honoured.
        RoundType roundType = req.roundType() != null ? req.roundType() : RoundType.DEFAULT;
        if (req.scheduledAt() == null) {
            throw InterviewSessionException.badRequest("session_slot_required", "scheduledAt is required");
        }
        String timezone = req.timezone() == null ? "" : req.timezone().trim();
        if (timezone.isEmpty()) {
            throw InterviewSessionException.badRequest("session_timezone_required", "timezone is required");
        }
        // Defence in depth: the UI disables past slots, but a session can't be booked in the past.
        if (req.scheduledAt().isBefore(Instant.now())) {
            throw InterviewSessionException.badRequest("session_slot_in_past", "the selected slot is in the past");
        }

        JobDescription jd = jdRepository.findById(req.jobDescriptionId())
                .orElseThrow(() -> new InterviewSessionException(
                        HttpStatus.BAD_REQUEST, "session_jd_not_found", "job description not found"));

        // The JD must map to a configured, enabled company/role/level — that's the (company, role,
        // level) the brief + question bank are keyed on, and it validates the round is available.
        CompanyRoleConfig config = configRepository
                .findByCompanyAndRoleAndLevel(jd.getCompany(), jd.getRole(), jd.getLevel())
                .orElseThrow(() -> new InterviewSessionException(HttpStatus.BAD_REQUEST,
                        "session_role_not_configured",
                        "this job description is not a configured interview target"));
        if (!config.isEnabled()) {
            throw new InterviewSessionException(HttpStatus.BAD_REQUEST, "session_role_disabled",
                    "interviews for this role are not currently available");
        }

        InterviewSession session = new InterviewSession(
                candidateId, jd, roundType, req.scheduledAt(), timezone);
        sessionRepository.save(session);
        return toResponse(session);
    }

    @Transactional(readOnly = true)
    public InterviewSessionListResponse listSessions(UUID candidateId) {
        List<InterviewSessionResponse> items = sessionRepository
                .findAllByCandidateIdOrderByScheduledAtDesc(candidateId)
                .stream().map(this::toResponse).toList();
        return new InterviewSessionListResponse(items);
    }

    @Transactional(readOnly = true)
    public InterviewSessionResponse getSession(UUID candidateId, UUID sessionId) {
        return toResponse(requireOwned(candidateId, sessionId));
    }

    /**
     * Re-queue prep for a session the candidate owns (retry after PREP_FAILED, or refresh). Moves it
     * to {@code PREP_QUEUED} and kicks off async generation. Idempotent — the ai-service returns the
     * cached plan when inputs are unchanged.
     */
    @Transactional
    public InterviewSessionResponse regenerate(UUID candidateId, UUID sessionId) {
        InterviewSession session = requireOwned(candidateId, sessionId);
        session.setStatus(SessionStatus.PREP_QUEUED);
        session.setPrepError(null);
        sessionRepository.save(session);
        prepService.generateAsync(session.getId());
        return toResponse(session);
    }

    private InterviewSession requireOwned(UUID candidateId, UUID sessionId) {
        return sessionRepository.findByIdAndCandidateId(sessionId, candidateId)
                .orElseThrow(InterviewSessionException::notFound);
    }

    private InterviewSessionResponse toResponse(InterviewSession session) {
        String companyName = companyRepository.findBySlug(session.getCompany())
                .map(Company::getName).orElse(null);
        return InterviewSessionResponse.from(session, companyName);
    }
}
