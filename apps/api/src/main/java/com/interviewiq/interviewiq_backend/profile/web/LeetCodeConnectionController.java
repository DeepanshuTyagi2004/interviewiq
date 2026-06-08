package com.interviewiq.interviewiq_backend.profile.web;

import com.interviewiq.interviewiq_backend.profile.leetcode.LeetCodeProfileException;
import com.interviewiq.interviewiq_backend.profile.leetcode.LeetCodeService;
import com.interviewiq.interviewiq_backend.profile.model.LeetCodeConnection;
import com.interviewiq.interviewiq_backend.profile.web.dto.ApiError;
import com.interviewiq.interviewiq_backend.profile.web.dto.ConnectLeetCodeRequest;
import com.interviewiq.interviewiq_backend.profile.web.dto.LeetCodeConnectResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * LeetCode connection endpoints. Same URL shape + auth model as the GitHub controller, but there is
 * no OAuth handshake: connect takes a username, validates it synchronously, and kicks off background
 * collection. All known failure modes map to a stable {@link ApiError} the frontend can render inline.
 */
@RestController
@RequestMapping(value = "/api/{version}/connections/leetcode", version = "1")
public class LeetCodeConnectionController {

    private static final Logger log = LoggerFactory.getLogger(LeetCodeConnectionController.class);

    private final LeetCodeService leetCodeService;

    public LeetCodeConnectionController(LeetCodeService leetCodeService) {
        this.leetCodeService = leetCodeService;
    }

    /**
     * Connect a LeetCode profile by username. Validates existence/public synchronously, then returns
     * 202 with status SYNCING while collection runs in the background. Requires a Bearer JWT.
     */
    @PostMapping
    public ResponseEntity<LeetCodeConnectResponse> connect(
            @AuthenticationPrincipal Jwt jwt,
            @RequestBody ConnectLeetCodeRequest request) {
        UUID userId = UUID.fromString(jwt.getSubject());
        LeetCodeConnection connection =
                leetCodeService.connect(userId, request == null ? null : request.username());
        return ResponseEntity.accepted().body(
                new LeetCodeConnectResponse(connection.getUsername(), connection.getStatus().name()));
    }

    /** Disconnect: delete the connection + LeetCode fragment. Requires a Bearer JWT. */
    @DeleteMapping
    public ResponseEntity<Void> disconnect(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        leetCodeService.disconnect(userId);
        return ResponseEntity.noContent().build();
    }

    // --- error mapping ---------------------------------------------------------------------------

    @ExceptionHandler(LeetCodeProfileException.class)
    public ResponseEntity<ApiError> handleProfileError(LeetCodeProfileException ex) {
        HttpStatus status = switch (ex.getReason()) {
            case USERNAME_NOT_FOUND -> HttpStatus.NOT_FOUND;          // 404
            case PROFILE_PRIVATE -> HttpStatus.UNPROCESSABLE_ENTITY;  // 422
            case RATE_LIMITED, UNREACHABLE -> HttpStatus.SERVICE_UNAVAILABLE; // 503
        };
        // Bad username / private / not-found are user-facing; transport errors are logged, not detailed.
        if (status == HttpStatus.SERVICE_UNAVAILABLE) {
            log.warn("LeetCode connect transient failure ({}): {}", ex.getCode(), ex.getMessage());
        }
        return ResponseEntity.status(status).body(new ApiError(ex.getCode(), ex.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleBadRequest(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(new ApiError("leetcode_bad_request", ex.getMessage()));
    }
}
