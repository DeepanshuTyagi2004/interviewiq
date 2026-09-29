package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.ScrapeTargetResponse;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * Internal, service-to-service endpoint (interviewiq-ai-service ↔ interviewiq-api),
 * guarded by the shared internal API key (path is permitAll in SecurityConfig; the key
 * check here is the gate). Serves the brief-generation targets: every active JD, so the
 * AI service generates one per-role round-by-round brief per (company, role, level,
 * specialization).
 */
@RestController
@RequestMapping(value = "/api/{version}/internal", version = "1")
public class InternalScrapeTargetController {

    private final JobDescriptionRepository jdRepository;
    private final String internalApiKey;

    public InternalScrapeTargetController(
            JobDescriptionRepository jdRepository,
            @Value("${internal.api-key}") String internalApiKey) {
        this.jdRepository = jdRepository;
        this.internalApiKey = internalApiKey;
    }

    /** Brief-generation targets — one per JD = (company, role, level, specialization). */
    @GetMapping("/scrape-targets")
    public ResponseEntity<?> scrapeTargets(
            @RequestHeader(value = "X-Internal-Api-Key", required = false) String key) {
        if (!keyMatches(key)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new ApiError("invalid_internal_key", "missing or invalid internal api key"));
        }
        List<ScrapeTargetResponse> targets = jdRepository.findAllByActiveTrueOrderByCompanyAscLevelAsc().stream()
                .map(j -> new ScrapeTargetResponse(
                        j.getCompany(), j.getRole(), j.getLevel(), j.getSpecialization(),
                        j.getTitle(), j.getSourceUrl(), j.getDescription()))
                .toList();
        return ResponseEntity.ok(targets);
    }

    /** Constant-time comparison so the check does not leak the key via timing. */
    private boolean keyMatches(String provided) {
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(
                provided.getBytes(StandardCharsets.UTF_8),
                internalApiKey.getBytes(StandardCharsets.UTF_8));
    }
}
