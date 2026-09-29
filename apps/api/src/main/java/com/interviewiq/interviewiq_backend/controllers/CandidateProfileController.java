package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.CandidateProfileRequest;
import com.interviewiq.interviewiq_backend.dtos.CandidateProfileResponse;
import com.interviewiq.interviewiq_backend.dtos.ResumeParseRunResponse;
import com.interviewiq.interviewiq_backend.services.CandidateProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;

import java.io.IOException;
import java.util.UUID;

/**
 * Onboarding candidate profile: résumé parse (prefill) + read/upsert of the editable details.
 *
 * <p>All endpoints are JWT-authed (default security rule). The résumé file is only forwarded to the
 * ai-service for parsing — never stored. Known failures map to a stable {@link ApiError} the
 * frontend renders inline and uses to fall back to manual entry.
 */
@RestController
@RequestMapping(value = "/api/{version}/users/me", version = "1")
public class CandidateProfileController {

    private static final Logger log = LoggerFactory.getLogger(CandidateProfileController.class);

    /** Authoritative résumé size cap. The multipart limit (application.properties) is a higher backstop. */
    private static final long MAX_RESUME_BYTES = 6L * 1024 * 1024;

    private final CandidateProfileService service;

    public CandidateProfileController(CandidateProfileService service) {
        this.service = service;
    }

    /** Parse an uploaded résumé PDF into an unsaved draft profile — synchronous (blocks on the LLM). */
    @PostMapping(value = "/resume/parse", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<CandidateProfileResponse> parseResume(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam("file") MultipartFile file) {
        byte[] bytes = readResumeBytes(file);
        return ResponseEntity.ok(service.parseResume(bytes, file.getOriginalFilename()));
    }

    /**
     * Start an async résumé parse (fire-and-poll). Returns immediately with the AI service's
     * {@code {run_id, status}}; the client polls {@link #resumeParseRun}. Decouples the wizard from
     * LLM latency — a slow model can't time out the request the way synchronous parsing does.
     */
    @PostMapping(value = "/resume/parse/start", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public JsonNode startResumeParse(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam("file") MultipartFile file) {
        byte[] bytes = readResumeBytes(file);
        String filename = file.getOriginalFilename();
        return service.startResumeParse(bytes, filename != null ? filename : "résumé.pdf");
    }

    /** Poll an async parse run: {@code {status: running|completed|failed, profile?, error?}}. */
    @GetMapping("/resume/parse/runs/{runId}")
    public ResumeParseRunResponse resumeParseRun(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable String runId) {
        return service.resumeParseRunStatus(runId);
    }

    /** Shared résumé-upload validation (empty / size / PDF) + read to bytes. */
    private byte[] readResumeBytes(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("the résumé file is empty");
        }
        if (file.getSize() > MAX_RESUME_BYTES) {
            throw new MaxUploadSizeExceededException(MAX_RESUME_BYTES);
        }
        String filename = file.getOriginalFilename();
        String contentType = file.getContentType();
        boolean looksPdf = (contentType != null && contentType.toLowerCase().contains("pdf"))
                || (filename != null && filename.toLowerCase().endsWith(".pdf"));
        if (!looksPdf) {
            throw new IllegalArgumentException("please upload a PDF résumé");
        }
        try {
            return file.getBytes();
        } catch (IOException ex) {
            throw new IllegalArgumentException("could not read the uploaded file");
        }
    }

    /** Current candidate profile, or 204 if the user hasn't saved one yet. */
    @GetMapping("/candidate-profile")
    public ResponseEntity<CandidateProfileResponse> getCandidateProfile(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        return service.getProfile(userId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** Upsert the candidate profile. {@code complete=true} finishes onboarding. */
    @PutMapping("/candidate-profile")
    public ResponseEntity<CandidateProfileResponse> saveCandidateProfile(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody CandidateProfileRequest request) {
        UUID userId = UUID.fromString(jwt.getSubject());
        return ResponseEntity.ok(service.saveProfile(userId, request));
    }

    // --- error mapping (stable codes the frontend keys on) ---

    /**
     * A non-2xx response from the ai-service. 422 means the PDF had no extractable text
     * (scanned/image-only) — tell the user to enter details manually; anything else is a generic
     * upstream failure.
     */
    @ExceptionHandler(HttpClientErrorException.class)
    public ResponseEntity<ApiError> handleUpstreamClientError(HttpClientErrorException ex) {
        if (ex.getStatusCode().value() == 422) {
            return ResponseEntity.status(422).body(new ApiError(
                    "resume_unreadable",
                    "We couldn't read that PDF — it may be a scanned image. Please enter your details manually."));
        }
        log.warn("résumé parse upstream client error {}: {}", ex.getStatusCode().value(), ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(new ApiError(
                "resume_parse_failed",
                "Résumé parsing is temporarily unavailable. Please try again or enter your details manually."));
    }

    /**
     * A 2xx body from the ai-service that isn't valid JSON (mapped by the service via ObjectMapper,
     * so it never becomes a RestClientException) — degrade to manual entry rather than a raw 500.
     */
    @ExceptionHandler(JacksonException.class)
    public ResponseEntity<ApiError> handleMalformedUpstream(JacksonException ex) {
        log.warn("résumé parse — malformed ai-service body: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(new ApiError(
                "resume_parse_failed",
                "Résumé parsing is temporarily unavailable. Please try again or enter your details manually."));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(new ApiError("resume_bad_request", ex.getMessage()));
    }

    /** Any other ai-service failure (transport, 5xx, malformed body) — degrade to manual entry. */
    @ExceptionHandler(RestClientException.class)
    public ResponseEntity<ApiError> handleUpstreamFailure(RestClientException ex) {
        log.warn("résumé parse upstream failure: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(new ApiError(
                "resume_parse_failed",
                "Résumé parsing is temporarily unavailable. Please try again or enter your details manually."));
    }
}
