package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.CreateInterviewSessionRequest;
import com.interviewiq.interviewiq_backend.dtos.InterviewSessionListResponse;
import com.interviewiq.interviewiq_backend.dtos.InterviewSessionResponse;
import com.interviewiq.interviewiq_backend.dtos.LiveSessionResponse;
import com.interviewiq.interviewiq_backend.services.InterviewSessionException;
import com.interviewiq.interviewiq_backend.services.InterviewSessionService;
import com.interviewiq.interviewiq_backend.services.LiveSessionService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * Candidate-facing interview booking + prep status (Pipeline 1), plus go-live + resume (sub-project
 * A, live-interview runtime). JWT-authed (default security rule); every endpoint is scoped to the
 * authenticated candidate. Mirrors the {@code interview-sessions} paths in {@code
 * contracts/openapi.yaml}. Debrief endpoints are not implemented here.
 */
@RestController
@RequestMapping(value = "/api/{version}/interviews", version = "1")
public class InterviewSessionController {

    private final InterviewSessionService service;
    private final LiveSessionService liveSessionService;

    public InterviewSessionController(InterviewSessionService service, LiveSessionService liveSessionService) {
        this.service = service;
        this.liveSessionService = liveSessionService;
    }

    /** Book a session for a JD + round + slot. */
    @PostMapping("/sessions")
    public ResponseEntity<InterviewSessionResponse> createSession(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody CreateInterviewSessionRequest request) {
        UUID candidateId = UUID.fromString(jwt.getSubject());
        return ResponseEntity.status(HttpStatus.CREATED).body(service.createSession(candidateId, request));
    }

    /** List the candidate's sessions (newest slot first). */
    @GetMapping("/sessions")
    public ResponseEntity<InterviewSessionListResponse> listSessions(@AuthenticationPrincipal Jwt jwt) {
        return ResponseEntity.ok(service.listSessions(UUID.fromString(jwt.getSubject())));
    }

    /** Get one session's status (owner-only). */
    @GetMapping("/sessions/{sessionId}")
    public ResponseEntity<InterviewSessionResponse> getSession(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID sessionId) {
        return ResponseEntity.ok(service.getSession(UUID.fromString(jwt.getSubject()), sessionId));
    }

    /** Re-queue prep for a session (retry after PREP_FAILED, or refresh). */
    @PostMapping("/sessions/{sessionId}/regenerate")
    public ResponseEntity<InterviewSessionResponse> regenerate(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID sessionId) {
        return ResponseEntity.accepted().body(
                service.regenerate(UUID.fromString(jwt.getSubject()), sessionId));
    }

    /** Go live: validate ownership + PREP_READY, mint a token, flip to LIVE_IN_PROGRESS. Resuming an
     *  already-live session returns a fresh token without changing state. */
    @PostMapping("/sessions/{sessionId}/live")
    public ResponseEntity<LiveSessionResponse> goLive(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID sessionId) {
        UUID candidateId = UUID.fromString(jwt.getSubject());
        return ResponseEntity.ok(liveSessionService.startLive(candidateId, sessionId));
    }

    /** Gate/resume: current live state, with a fresh token when already live. */
    @GetMapping("/sessions/{sessionId}/live")
    public ResponseEntity<LiveSessionResponse> liveState(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID sessionId) {
        UUID candidateId = UUID.fromString(jwt.getSubject());
        return ResponseEntity.ok(liveSessionService.getLive(candidateId, sessionId));
    }

    // --- error mapping (stable codes the frontend keys on) ---

    @ExceptionHandler(InterviewSessionException.class)
    public ResponseEntity<ApiError> handleSessionError(InterviewSessionException ex) {
        return ResponseEntity.status(ex.status()).body(new ApiError(ex.code(), ex.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(new ApiError("session_bad_request", ex.getMessage()));
    }
}
