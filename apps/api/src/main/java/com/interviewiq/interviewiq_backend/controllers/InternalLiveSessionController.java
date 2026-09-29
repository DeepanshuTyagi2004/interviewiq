package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.services.LiveSessionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

/**
 * Internal, service-to-service endpoint (Python live-interview worker → interviewiq-backend),
 * guarded by the shared internal API key (path is permitAll in SecurityConfig; the key check
 * here is the gate). Called once, when the interview ends: persists the {@code SessionOutcome}
 * JSON verbatim and flips the session to its terminal status.
 */
@RestController
@RequestMapping(value = "/api/{version}/internal", version = "1")
public class InternalLiveSessionController {

    private final LiveSessionService liveSessionService;
    private final String internalApiKey;

    public InternalLiveSessionController(
            LiveSessionService liveSessionService,
            @Value("${internal.api-key}") String internalApiKey) {
        this.liveSessionService = liveSessionService;
        this.internalApiKey = internalApiKey;
    }

    @PostMapping("/sessions/{sessionId}/outcome")
    public ResponseEntity<?> recordOutcome(
            @RequestHeader(value = "X-Internal-Api-Key", required = false) String key,
            @PathVariable UUID sessionId,
            @RequestBody JsonNode outcome) {
        if (!keyMatches(key)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new ApiError("invalid_internal_key", "missing or invalid internal api key"));
        }
        liveSessionService.recordOutcome(sessionId, outcome);
        return ResponseEntity.noContent().build();
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
