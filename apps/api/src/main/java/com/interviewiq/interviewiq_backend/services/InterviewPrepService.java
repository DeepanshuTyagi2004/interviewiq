package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.ResumeLinksDto;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanCandidateProfile;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanCodingProfile;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanJobDescription;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanSessionContext;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.UUID;

/**
 * Builds interview prep for one session by assembling the ai-service request (session context + JD
 * + candidate profile — this is the seam the ai-service depends on) and calling it. On success the
 * session moves to {@code PREP_READY} with the plan reference (version + input hash); on any failure
 * it moves to {@code PREP_FAILED} and logs.
 *
 * <p>The slow HTTP call runs OUTSIDE any DB transaction; status transitions are individual saves.
 * Safe to call repeatedly — the ai-service caches on the input hash, so an unchanged re-request
 * costs no LLM work.
 */
@Service
public class InterviewPrepService {

    private static final Logger log = LoggerFactory.getLogger(InterviewPrepService.class);

    private final InterviewSessionRepository sessionRepository;
    private final JobDescriptionRepository jdRepository;
    private final CandidateProfileService candidateProfileService;
    private final CodingSignalsProvider codingSignalsProvider;
    private final AiServiceClient aiServiceClient;
    private final long pollIntervalMs;
    private final long maxWaitMs;

    public InterviewPrepService(
            InterviewSessionRepository sessionRepository,
            JobDescriptionRepository jdRepository,
            CandidateProfileService candidateProfileService,
            CodingSignalsProvider codingSignalsProvider,
            AiServiceClient aiServiceClient,
            @Value("${interviewprep.plan-poll-interval-ms:2000}") long pollIntervalMs,
            @Value("${interviewprep.plan-max-wait-ms:180000}") long maxWaitMs) {
        this.sessionRepository = sessionRepository;
        this.jdRepository = jdRepository;
        this.candidateProfileService = candidateProfileService;
        this.codingSignalsProvider = codingSignalsProvider;
        this.aiServiceClient = aiServiceClient;
        this.pollIntervalMs = pollIntervalMs;
        this.maxWaitMs = maxWaitMs;
    }

    /** Fire-and-forget prep generation (used by the manual regenerate so the request returns fast). */
    @Async
    public void generateAsync(UUID sessionId) {
        try {
            generatePrep(sessionId);
        } catch (RuntimeException ex) {
            // generatePrep already records PREP_FAILED; this only guards the async boundary.
            log.warn("async prep generation threw for session {}: {}", sessionId, ex.getMessage());
        }
    }

    /**
     * Generate prep for one session: PREP_QUEUED → start ai-service run → poll → PREP_READY |
     * PREP_FAILED. Called synchronously by the scheduler and (via {@link #generateAsync}) by regenerate.
     *
     * <p>Fire-and-poll rather than one blocking call: Stage 2 fires three concurrent LLM reasoning
     * calls, and on a slower model the tail can run past the HTTP client read timeout — which used to
     * surface as a transport error and wrongly mark the session PREP_FAILED. Now every call is short:
     * start returns a run id immediately, then we poll a fast status endpoint until terminal.
     */
    public void generatePrep(UUID sessionId) {
        InterviewSession session = sessionRepository.findById(sessionId).orElse(null);
        if (session == null) {
            log.warn("prep: session {} no longer exists — skipping", sessionId);
            return;
        }
        markStatus(session, SessionStatus.PREP_QUEUED, null);
        try {
            GenerateInterviewPlanRequest body = assembleRequest(session);
            String runId = aiServiceClient.startInterviewPlan(body);
            applySuccess(session, awaitPlan(runId));
        } catch (PrepGenerationException ex) {
            applyFailure(session, ex.code, ex.getMessage());
        } catch (RestClientResponseException ex) {
            applyFailure(session, "prep_generation_upstream_" + ex.getStatusCode().value(), ex.getMessage());
        } catch (RuntimeException ex) {
            applyFailure(session, "prep_generation_failed", ex.getMessage());
        }
    }

    /**
     * Poll the started run until it is terminal, returning the finished plan doc on {@code completed}.
     * Throws {@link PrepGenerationException} on {@code failed} (carrying the ai-service error code) or
     * when the {@code maxWaitMs} budget is exhausted while still {@code running}. Each poll is a fast
     * HTTP call — the total wait is bounded here, not by a single request's read timeout.
     */
    private JsonNode awaitPlan(String runId) {
        long deadline = System.currentTimeMillis() + maxWaitMs;
        while (true) {
            JsonNode snap = aiServiceClient.getInterviewPlanRun(runId);
            String status = text(snap, "status");
            if ("completed".equals(status)) {
                return snap.path("plan");
            }
            if ("failed".equals(status)) {
                JsonNode error = snap.path("error");
                String code = text(error, "code");
                throw new PrepGenerationException(
                        "prep_generation_" + (code != null ? code : "failed"),
                        text(error, "message"));
            }
            if (System.currentTimeMillis() >= deadline) {
                throw new PrepGenerationException("prep_generation_timeout",
                        "plan not ready within " + maxWaitMs + "ms (run " + runId + ")");
            }
            sleep();
        }
    }

    private void sleep() {
        try {
            Thread.sleep(pollIntervalMs);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new PrepGenerationException("prep_generation_interrupted", "prep polling interrupted");
        }
    }

    /** Terminal prep failure carrying the {@code prep_error} code recorded on the session. */
    private static final class PrepGenerationException extends RuntimeException {
        private final String code;

        PrepGenerationException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    /** Assemble the ai-service request body. Package-visible so tests can assert its shape. */
    GenerateInterviewPlanRequest assembleRequest(InterviewSession session) {
        JobDescription jd = jdRepository.findById(session.getJobDescriptionId())
                .orElseThrow(() -> new IllegalStateException(
                        "job description " + session.getJobDescriptionId() + " gone for session " + session.getId()));

        PlanSessionContext sessionCtx = new PlanSessionContext(
                session.getId(), session.getCandidateId(), session.getCompany(), session.getRole(),
                session.getLevel(), session.getSpecialization(), session.getRoundType());

        PlanJobDescription jdDto = new PlanJobDescription(
                jd.getId(), jd.getTitle(), jd.getDescription(), jd.getTechStack());

        // The descriptive candidate profile (may be absent — the plan is still buildable without it).
        PlanCodingProfile coding = codingSignalsProvider.forUser(session.getCandidateId());
        PlanCandidateProfile profile = candidateProfileService.getProfile(session.getCandidateId())
                .map(p -> new PlanCandidateProfile(
                        p.fullName(), p.headline(), p.targetRole(),
                        p.education(), p.experience(), p.projects(), p.skills(), p.achievements(),
                        p.detectedLinks(), coding))
                .orElseGet(() -> new PlanCandidateProfile(
                        null, null, null, List.of(), List.of(), List.of(), List.of(), List.of(),
                        new ResumeLinksDto(null, null, null), coding));

        return new GenerateInterviewPlanRequest(sessionCtx, jdDto, profile);
    }

    private void applySuccess(InterviewSession session, JsonNode plan) {
        JsonNode provenance = plan.path("provenance");
        session.setPlanVersion(text(provenance, "planVersion"));
        session.setInputHash(text(provenance, "inputHash"));
        session.setPrepError(null);
        session.setStatus(SessionStatus.PREP_READY);
        sessionRepository.save(session);
        log.info("prep READY for session {} (planVersion={}, inputHash={})",
                session.getId(), session.getPlanVersion(), session.getInputHash());
    }

    private void applyFailure(InterviewSession session, String code, String detail) {
        session.setStatus(SessionStatus.PREP_FAILED);
        session.setPrepError(code);
        sessionRepository.save(session);
        log.warn("prep FAILED for session {} ({}): {}", session.getId(), code, detail);
    }

    private void markStatus(InterviewSession session, SessionStatus status, String error) {
        session.setStatus(status);
        session.setPrepError(error);
        sessionRepository.save(session);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asString();
    }
}
