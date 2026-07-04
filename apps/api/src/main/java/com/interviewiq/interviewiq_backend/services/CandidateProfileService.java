package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.CandidateProfileRequest;
import com.interviewiq.interviewiq_backend.dtos.CandidateProfileResponse;
import com.interviewiq.interviewiq_backend.dtos.EducationDto;
import com.interviewiq.interviewiq_backend.dtos.ExperienceDto;
import com.interviewiq.interviewiq_backend.dtos.ProjectDto;
import com.interviewiq.interviewiq_backend.dtos.ResumeLinksDto;
import com.interviewiq.interviewiq_backend.dtos.ResumeParseRunResponse;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiParsedResume;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.models.CandidateProfile;
import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.repositories.CandidateProfileRepository;
import com.interviewiq.interviewiq_backend.repositories.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.HttpClientErrorException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Onboarding candidate profile: résumé parsing (stateless), read, and upsert.
 *
 * <p>Parsing is a thin proxy — the ai-service does the PDF + LLM work; we only map its snake_case
 * JSON onto the public DTO shape and hand back an unsaved draft the wizard prefills. Persistence
 * stores the repeating collections as jsonb strings and, on the final Finish, flips
 * {@code User.onboardingComplete}. Jackson 3 throws unchecked, so JSON (de)serialization needs no
 * checked-exception handling; a malformed AI response surfaces as a runtime error the controller
 * maps to 502.
 */
@Service
public class CandidateProfileService {

    private final CandidateProfileRepository repository;
    private final UserRepository userRepository;
    private final AiServiceClient aiServiceClient;
    private final ObjectMapper objectMapper;

    public CandidateProfileService(
            CandidateProfileRepository repository,
            UserRepository userRepository,
            AiServiceClient aiServiceClient,
            ObjectMapper objectMapper) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.aiServiceClient = aiServiceClient;
        this.objectMapper = objectMapper;
    }

    /**
     * Parse a résumé PDF into an unsaved draft profile (prefills the wizard). Nothing is stored;
     * the file itself is discarded after extraction. Propagates the ai-service failure (e.g. 422
     * for an unreadable/scanned PDF) so the controller can surface it — a failed parse must not be
     * silently swallowed the way a missing brief is.
     */
    public CandidateProfileResponse parseResume(byte[] pdfBytes, String filename) {
        String raw = aiServiceClient.parseResume(pdfBytes);
        AiParsedResume parsed = objectMapper.readValue(raw, AiParsedResume.class);
        return toDraft(parsed, filename);
    }

    // --- async parse (fire-and-poll) — decouples the wizard from LLM latency -----------------

    /** Start a background résumé-parse run; returns the AI service's {run_id, status} to poll. */
    public JsonNode startResumeParse(byte[] pdfBytes, String filename) {
        return aiServiceClient.startResumeParseRun(pdfBytes, filename);
    }

    /** Poll a run: running → no profile; completed → the draft; failed → a user-facing message. */
    public ResumeParseRunResponse resumeParseRunStatus(String runId) {
        JsonNode snap;
        try {
            snap = aiServiceClient.getResumeParseRun(runId, 0);
        } catch (HttpClientErrorException.NotFound ex) {
            return new ResumeParseRunResponse("failed", null,
                    "This parse expired — please upload the résumé again.");
        }
        String status = snap.path("status").asString();
        if ("completed".equals(status) && snap.hasNonNull("result")) {
            AiParsedResume parsed = objectMapper.treeToValue(snap.get("result"), AiParsedResume.class);
            // resumeFilename is set client-side (it has the uploaded name); the run result carries none.
            return new ResumeParseRunResponse("completed", toDraft(parsed, null), null);
        }
        if ("failed".equals(status)) {
            JsonNode message = snap.path("error").path("message");
            return new ResumeParseRunResponse("failed", null,
                    message.isMissingNode() || message.isNull()
                            ? "We couldn't parse that résumé. Please try again or enter your details manually."
                            : message.asString());
        }
        return new ResumeParseRunResponse("running", null, null);
    }

    private CandidateProfileResponse toDraft(AiParsedResume parsed, String filename) {
        return new CandidateProfileResponse(
                parsed.fullName(), parsed.email(), parsed.phone(), parsed.location(), parsed.headline(),
                null,
                mapEducation(parsed.education()),
                mapExperience(parsed.experience()),
                mapProjects(parsed.projects()),
                safe(parsed.skills()),
                safe(parsed.achievements()),
                mapLinks(parsed.links()),
                filename,
                null,
                false
        );
    }

    @Transactional(readOnly = true)
    public Optional<CandidateProfileResponse> getProfile(UUID userId) {
        boolean onboarded = userRepository.findById(userId)
                .map(User::isOnboardingComplete)
                .orElse(false);
        return repository.findByUserId(userId).map(cp -> toResponse(cp, onboarded));
    }

    @Transactional
    public CandidateProfileResponse saveProfile(UUID userId, CandidateProfileRequest req) {
        CandidateProfile cp = repository.findByUserId(userId)
                .orElseGet(() -> new CandidateProfile(userId));

        cp.setFullName(req.fullName());
        cp.setEmail(req.email());
        cp.setPhone(req.phone());
        cp.setLocation(req.location());
        cp.setHeadline(req.headline());
        cp.setTargetRole(req.targetRole());
        cp.setEducation(writeJson(req.education(), "[]"));
        cp.setExperience(writeJson(req.experience(), "[]"));
        cp.setProjects(writeJson(req.projects(), "[]"));
        cp.setSkills(writeJson(req.skills(), "[]"));
        cp.setAchievements(writeJson(req.achievements(), "[]"));
        cp.setDetectedLinks(writeJson(req.detectedLinks(), "{}"));

        // Stamp parse time only when the résumé actually changed — re-saving the same filename on a
        // plain details edit must not keep bumping resumeParsedAt.
        String newFilename = trimToNull(req.resumeFilename());
        if (newFilename != null && !Objects.equals(newFilename, cp.getResumeFilename())) {
            cp.setResumeFilename(newFilename);
            cp.setResumeParsedAt(Instant.now());
        }

        repository.save(cp);

        // The user is guaranteed to exist (endpoint is JWT-authed against a persisted user).
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalStateException("authenticated user not found: " + userId));
        if (req.complete() && !user.isOnboardingComplete()) {
            user.setOnboardingComplete(true);
            userRepository.save(user);
        }

        return toResponse(cp, user.isOnboardingComplete());
    }

    // --- mapping helpers ---

    private CandidateProfileResponse toResponse(CandidateProfile cp, boolean onboardingComplete) {
        return new CandidateProfileResponse(
                cp.getFullName(), cp.getEmail(), cp.getPhone(), cp.getLocation(), cp.getHeadline(),
                cp.getTargetRole(),
                readList(cp.getEducation(), EducationDto[].class),
                readList(cp.getExperience(), ExperienceDto[].class),
                readList(cp.getProjects(), ProjectDto[].class),
                readList(cp.getSkills(), String[].class),
                readList(cp.getAchievements(), String[].class),
                readLinks(cp.getDetectedLinks()),
                cp.getResumeFilename(),
                cp.getResumeParsedAt(),
                onboardingComplete
        );
    }

    private String writeJson(Object value, String fallback) {
        return value == null ? fallback : objectMapper.writeValueAsString(value);
    }

    private <T> List<T> readList(String json, Class<T[]> arrayType) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        return Arrays.asList(objectMapper.readValue(json, arrayType));
    }

    private ResumeLinksDto readLinks(String json) {
        if (json == null || json.isBlank()) {
            return new ResumeLinksDto(null, null, null);
        }
        return objectMapper.readValue(json, ResumeLinksDto.class);
    }

    private List<EducationDto> mapEducation(List<AiParsedResume.Education> in) {
        if (in == null) {
            return List.of();
        }
        return in.stream()
                .map(e -> new EducationDto(e.institution(), e.degree(), e.field(),
                        e.startYear(), e.endYear(), e.grade()))
                .toList();
    }

    private List<ExperienceDto> mapExperience(List<AiParsedResume.Experience> in) {
        if (in == null) {
            return List.of();
        }
        return in.stream()
                .map(x -> new ExperienceDto(x.company(), x.title(), x.startDate(), x.endDate(),
                        x.location(), safe(x.bullets())))
                .toList();
    }

    private List<ProjectDto> mapProjects(List<AiParsedResume.Project> in) {
        if (in == null) {
            return List.of();
        }
        return in.stream()
                .map(p -> new ProjectDto(p.name(), p.description(), safe(p.tech()), safe(p.bullets()), p.link()))
                .toList();
    }

    private ResumeLinksDto mapLinks(AiParsedResume.Links l) {
        return l == null
                ? new ResumeLinksDto(null, null, null)
                : new ResumeLinksDto(l.github(), l.leetcode(), l.linkedin());
    }

    private static <T> List<T> safe(List<T> list) {
        return list == null ? List.of() : list;
    }

    private static String trimToNull(String s) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
