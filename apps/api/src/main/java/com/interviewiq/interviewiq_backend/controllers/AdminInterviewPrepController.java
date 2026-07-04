package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.ResumeLinksDto;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanCandidateProfile;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanCodingProfile;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanJobDescription;
import com.interviewiq.interviewiq_backend.integrations.aiservice.GenerateInterviewPlanRequest.PlanSessionContext;
import com.interviewiq.interviewiq_backend.models.CandidateProfile;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.models.RoundType;
import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.repositories.CandidateProfileRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import com.interviewiq.interviewiq_backend.repositories.UserRepository;
import com.interviewiq.interviewiq_backend.services.CandidateProfileService;
import com.interviewiq.interviewiq_backend.services.CodingSignalsProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * BFF proxy for the interview-prep (Pipeline 1) observability console (admin test-bench). The admin
 * picks a JD + round (+ optional candidate); this controller assembles the same request the
 * scheduler sends to {@code /interview-plans} — using a synthetic session id — and forwards it to
 * the AI service's instrumented run endpoint, then proxies the run snapshots the console polls.
 *
 * <p>Gated to ADMIN in SecurityConfig ({@code /api/v1/intelligence/**}).
 */
@RestController
@RequestMapping(value = "/api/{version}/intelligence/interview-prep", version = "1")
public class AdminInterviewPrepController {

    private static final Logger log = LoggerFactory.getLogger(AdminInterviewPrepController.class);

    private final JobDescriptionRepository jdRepository;
    private final CandidateProfileService candidateProfileService;
    private final CandidateProfileRepository candidateProfileRepository;
    private final UserRepository userRepository;
    private final CodingSignalsProvider codingSignalsProvider;
    private final AiServiceClient aiServiceClient;

    public AdminInterviewPrepController(
            JobDescriptionRepository jdRepository,
            CandidateProfileService candidateProfileService,
            CandidateProfileRepository candidateProfileRepository,
            UserRepository userRepository,
            CodingSignalsProvider codingSignalsProvider,
            AiServiceClient aiServiceClient) {
        this.jdRepository = jdRepository;
        this.candidateProfileService = candidateProfileService;
        this.candidateProfileRepository = candidateProfileRepository;
        this.userRepository = userRepository;
        this.codingSignalsProvider = codingSignalsProvider;
        this.aiServiceClient = aiServiceClient;
    }

    /** An onboarded candidate the admin can run the pipeline against (has a saved profile). */
    public record CandidateOption(UUID id, String name, String email) {
    }

    /**
     * Onboarded candidates (those with a saved {@code CandidateProfile}) for the bench dropdown,
     * newest profiles first-ish — sorted by name. Each carries the userId to send as {@code candidateId}.
     */
    @GetMapping("/candidates")
    public List<CandidateOption> candidates() {
        List<CandidateProfile> profiles = candidateProfileRepository.findAll();
        Map<UUID, User> users = userRepository
                .findAllById(profiles.stream().map(CandidateProfile::getUserId).toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));
        return profiles.stream()
                .map(p -> {
                    User u = users.get(p.getUserId());
                    String name = firstNonBlank(u != null ? u.getName() : null, p.getFullName(), "Unnamed candidate");
                    String email = u != null ? u.getEmail() : p.getEmail();
                    return new CandidateOption(p.getUserId(), name, email);
                })
                .sorted(Comparator.comparing(c -> c.name().toLowerCase()))
                .toList();
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return null;
    }

    /** Bench inputs: a JD (resolves company/role/level) and an optional candidate whose profile
     *  grounds the probes. Like the real flow, the round is not chosen — it defaults to the first
     *  round; {@code roundType} is honoured only if explicitly supplied. */
    public record BenchPlanRequest(UUID jobDescriptionId, RoundType roundType, UUID candidateId) {
    }

    /** Assemble the plan request and start an instrumented run. Returns {run_id, status}. */
    @PostMapping("/run")
    public JsonNode startRun(@RequestBody BenchPlanRequest req) {
        if (req.jobDescriptionId() == null) {
            throw new IllegalArgumentException("jobDescriptionId is required");
        }
        JobDescription jd = jdRepository.findById(req.jobDescriptionId())
                .orElseThrow(() -> new IllegalArgumentException("unknown job description"));

        RoundType roundType = req.roundType() != null ? req.roundType() : RoundType.DEFAULT;
        UUID candidateId = req.candidateId() != null ? req.candidateId() : UUID.randomUUID();
        PlanSessionContext sessionCtx = new PlanSessionContext(
                UUID.randomUUID(), candidateId, jd.getCompany(), jd.getRole(),
                jd.getLevel(), jd.getSpecialization(), roundType);
        PlanJobDescription jdDto = new PlanJobDescription(
                jd.getId(), jd.getTitle(), jd.getDescription(), jd.getTechStack());

        PlanCandidateProfile profile = resolveProfile(req.candidateId());
        return aiServiceClient.startInterviewPrepRun(
                new GenerateInterviewPlanRequest(sessionCtx, jdDto, profile));
    }

    private PlanCandidateProfile resolveProfile(UUID candidateId) {
        if (candidateId == null) {
            return emptyProfile(null);
        }
        PlanCodingProfile coding = codingSignalsProvider.forUser(candidateId);
        return candidateProfileService.getProfile(candidateId)
                .map(p -> new PlanCandidateProfile(
                        p.fullName(), p.headline(), p.targetRole(),
                        p.education(), p.experience(), p.projects(), p.skills(), p.achievements(),
                        p.detectedLinks(), coding))
                .orElseGet(() -> emptyProfile(coding));
    }

    private static PlanCandidateProfile emptyProfile(PlanCodingProfile coding) {
        return new PlanCandidateProfile(null, null, null, List.of(), List.of(), List.of(), List.of(),
                List.of(), new ResumeLinksDto(null, null, null), coding);
    }

    /** Recent interview-prep runs (newest first). */
    @GetMapping("/runs")
    public JsonNode listRuns() {
        return aiServiceClient.listInterviewPrepRuns();
    }

    /** Snapshot of one run. Poll with ?after=<last_seq> for incremental logs. */
    @GetMapping("/runs/{runId}")
    public JsonNode runStatus(@PathVariable String runId,
                              @RequestParam(name = "after", defaultValue = "0") long after) {
        return aiServiceClient.getInterviewPrepRun(runId, after);
    }

    // --- error mapping -----------------------------------------------------------------------

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(new ApiError("prep_bad_request", ex.getMessage()));
    }

    @ExceptionHandler(HttpClientErrorException.NotFound.class)
    public ResponseEntity<ApiError> handleUnknownRun(HttpClientErrorException.NotFound ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ApiError("run_not_found", "no such interview-prep run"));
    }

    @ExceptionHandler(RestClientException.class)
    public ResponseEntity<ApiError> handleAiServiceDown(RestClientException ex) {
        log.warn("AI service interview-prep run call failed: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ApiError("ai_service_unreachable", "the intelligence service is not reachable"));
    }
}
