package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.SubmitExperienceRequest;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;

/**
 * First-party interview-experience submission. Any authenticated user (a candidate
 * who just interviewed) can share their experience; it's forwarded to the AI service
 * and flows through the same extraction → brief pipeline as scraped data.
 *
 * Not admin-gated — falls under the default authenticated() rule in SecurityConfig.
 */
@RestController
@RequestMapping(value = "/api/{version}/experiences", version = "1")
public class ExperienceController {

    private static final Logger log = LoggerFactory.getLogger(ExperienceController.class);

    private final AiServiceClient aiServiceClient;

    public ExperienceController(AiServiceClient aiServiceClient) {
        this.aiServiceClient = aiServiceClient;
    }

    @PostMapping
    public ResponseEntity<?> submit(@RequestBody SubmitExperienceRequest request) {
        if (request == null
                || isBlank(request.company())
                || isBlank(request.level())
                || isBlank(request.content())) {
            return ResponseEntity.badRequest()
                    .body(new ApiError("invalid_experience", "company, level and content are required"));
        }
        String role = isBlank(request.role()) ? "software-engineer" : request.role();
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(
                aiServiceClient.submitExperience(request.company(), role, request.level(), request.content()));
    }

    @ExceptionHandler(RestClientException.class)
    public ResponseEntity<ApiError> handleAiServiceDown(RestClientException ex) {
        log.warn("AI service submit failed: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ApiError("ai_service_unreachable", "the intelligence service is not reachable"));
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
