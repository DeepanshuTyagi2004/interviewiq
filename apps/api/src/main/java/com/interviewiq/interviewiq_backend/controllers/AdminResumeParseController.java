package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;

import java.io.IOException;

/**
 * BFF proxy for the résumé-parse observability console (admin test-bench). The browser uploads a
 * PDF with its JWT; this controller forwards the bytes to the AI service with the internal API key
 * to start an instrumented run, then proxies the run snapshots the console polls.
 *
 * <p>Distinct from {@link CandidateProfileController#parseResume}: that is the user-facing,
 * synchronous onboarding parse. This is an admin, background, fully-observable copy.
 *
 * <p>Gated to ADMIN in SecurityConfig ({@code /api/v1/intelligence/**}).
 */
@RestController
@RequestMapping(value = "/api/{version}/intelligence/resume", version = "1")
public class AdminResumeParseController {

    private static final Logger log = LoggerFactory.getLogger(AdminResumeParseController.class);

    /** Same authoritative cap as the onboarding parse; the multipart limit is a higher backstop. */
    private static final long MAX_RESUME_BYTES = 6L * 1024 * 1024;

    private final AiServiceClient aiServiceClient;

    public AdminResumeParseController(AiServiceClient aiServiceClient) {
        this.aiServiceClient = aiServiceClient;
    }

    /** Upload a PDF and start an instrumented parse run. Returns the AI service's {run_id, status}. */
    @PostMapping(value = "/parse/run", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public JsonNode startRun(@RequestParam("file") MultipartFile file) {
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
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new IllegalArgumentException("could not read the uploaded file");
        }
        return aiServiceClient.startResumeParseRun(bytes, filename != null ? filename : "résumé.pdf");
    }

    /** Recent résumé-parse runs (newest first). */
    @GetMapping("/parse/runs")
    public JsonNode listRuns() {
        return aiServiceClient.listResumeParseRuns();
    }

    /** Snapshot of one run. Poll with ?after=<last_seq> for incremental logs. */
    @GetMapping("/parse/runs/{runId}")
    public JsonNode runStatus(@PathVariable String runId,
                              @RequestParam(name = "after", defaultValue = "0") long after) {
        return aiServiceClient.getResumeParseRun(runId, after);
    }

    // --- error mapping -----------------------------------------------------------------------

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(new ApiError("resume_bad_request", ex.getMessage()));
    }

    @ExceptionHandler(HttpClientErrorException.NotFound.class)
    public ResponseEntity<ApiError> handleUnknownRun(HttpClientErrorException.NotFound ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(new ApiError("run_not_found", "no such résumé-parse run"));
    }

    @ExceptionHandler(RestClientException.class)
    public ResponseEntity<ApiError> handleAiServiceDown(RestClientException ex) {
        log.warn("AI service résumé-run call failed: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ApiError("ai_service_unreachable", "the intelligence service is not reachable"));
    }
}
