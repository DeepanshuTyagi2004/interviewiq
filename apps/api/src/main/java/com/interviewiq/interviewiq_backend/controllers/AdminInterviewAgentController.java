package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;

import java.util.function.Supplier;

/**
 * BFF proxy for the Agent Diagnostics console (admin test-bench) — an interactive harness
 * around the live-interview LangGraph brain. Mirrors {@link AdminInterviewPrepController}'s
 * shape: the admin assembles a plan, this controller forwards it to the AI service's
 * instrumented agent-run endpoints and proxies the run snapshots the console polls.
 *
 * <p>Gated to ADMIN in SecurityConfig ({@code /api/v1/intelligence/**}).
 */
@RestController
@RequestMapping(value = "/api/{version}/intelligence/interview-agent", version = "1")
public class AdminInterviewAgentController {

    private static final Logger log = LoggerFactory.getLogger(AdminInterviewAgentController.class);

    private final AiServiceClient aiService;

    public AdminInterviewAgentController(AiServiceClient aiService) {
        this.aiService = aiService;
    }

    /** Assemble the plan request and start an interactive diagnostic session. Returns {run_id, status}. */
    @PostMapping("/run")
    public ResponseEntity<?> start(@RequestBody JsonNode plan) {
        return proxy(() -> aiService.startAgentRun(plan));
    }

    /** Submit a candidate turn (or silence/end) to a diagnostic session. */
    @PostMapping("/runs/{runId}/turn")
    public ResponseEntity<?> turn(@PathVariable String runId, @RequestBody JsonNode body) {
        return proxy(() -> aiService.submitAgentTurn(runId, body));
    }

    /** Snapshot of one run. Poll with ?after=<last_seq> for incremental logs. */
    @GetMapping("/runs/{runId}")
    public ResponseEntity<?> get(@PathVariable String runId, @RequestParam(defaultValue = "0") long after) {
        return proxy(() -> aiService.getAgentRun(runId, after));
    }

    /** Recent diagnostic sessions (newest first). */
    @GetMapping("/runs")
    public ResponseEntity<?> list() {
        return proxy(aiService::listAgentRuns);
    }

    /** Force-end a diagnostic session. */
    @PostMapping("/runs/{runId}/end")
    public ResponseEntity<?> end(@PathVariable String runId) {
        return proxy(() -> aiService.endAgentRun(runId));
    }

    // --- error mapping -----------------------------------------------------------------------

    private ResponseEntity<?> proxy(Supplier<JsonNode> call) {
        try {
            return ResponseEntity.ok(call.get());
        } catch (HttpClientErrorException.NotFound ex) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(new ApiError("run_not_found", "no such diagnostic session"));
        } catch (HttpClientErrorException.TooManyRequests ex) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new ApiError("sessions_at_capacity", "too many active diagnostic sessions"));
        } catch (RestClientException ex) {
            log.warn("AI service interview-agent call failed: {}", ex.getMessage());
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(new ApiError("ai_service_unreachable", "ai-service unavailable"));
        }
    }
}
