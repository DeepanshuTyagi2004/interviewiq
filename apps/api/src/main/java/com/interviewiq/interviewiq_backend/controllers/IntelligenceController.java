package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

/**
 * BFF proxy for the interview-intelligence (scraping) pipeline. The browser talks to
 * this ADMIN-gated endpoint with its JWT; this controller forwards to the AI service
 * with the internal API key. The internal key never reaches the browser.
 *
 * Gated to ADMIN in SecurityConfig ({@code /api/v1/intelligence/**}).
 */
@RestController
@RequestMapping(value = "/api/{version}/intelligence", version = "1")
public class IntelligenceController {

    private static final Logger log = LoggerFactory.getLogger(IntelligenceController.class);

    private final AiServiceClient aiServiceClient;

    public IntelligenceController(AiServiceClient aiServiceClient) {
        this.aiServiceClient = aiServiceClient;
    }

    /** Trigger a pipeline run. Returns the AI service's {run_id, status, already_running}. */
    @PostMapping("/scrape/run")
    public JsonNode runScrape() {
        return aiServiceClient.triggerScrape();
    }

    /** Stop the active ingestion run (halts after the current JD). */
    @PostMapping("/scrape/stop")
    public JsonNode stopScrape() {
        return aiServiceClient.stopScrape();
    }

    /** Live run state + incremental verbose logs. Poll with ?after=<last_seq>. */
    @GetMapping("/scrape/status")
    public JsonNode scrapeStatus(@RequestParam(name = "after", defaultValue = "0") long after) {
        return aiServiceClient.getScrapeStatus(after);
    }

    /** Trigger a question-set collection run. Returns the AI service's {run_id, status, already_running}.
     *  Status is watched via the shared /scrape/status feed (the AI service uses one run slot). */
    @PostMapping("/questions/collect")
    public JsonNode collectQuestions() {
        return aiServiceClient.collectQuestions();
    }

    /** List ingested questions from the bank (metadata only) for the admin Question-bank tab. */
    @GetMapping("/questions")
    public ResponseEntity<?> questions(
            @RequestParam(name = "roundType", required = false) String roundType,
            @RequestParam(name = "company", required = false) String company,
            @RequestParam(name = "difficulty", required = false) String difficulty,
            @RequestParam(name = "limit", defaultValue = "100") int limit) {
        return ResponseEntity.ok(aiServiceClient.listQuestions(roundType, company, difficulty, Math.min(limit, 500))
                .<Object>map(node -> node)
                .orElseGet(() -> Map.of("questions", List.of(), "count", 0)));
    }

    /** Clear all generated briefs (destructive). The catalogue is untouched. */
    @PostMapping("/briefs/clear")
    public JsonNode clearBriefs() {
        return aiServiceClient.clearBriefs();
    }

    /** List every generated brief (summaries) so the console can show what already exists. */
    @GetMapping("/briefs")
    public ResponseEntity<?> briefs() {
        return ResponseEntity.ok(aiServiceClient.listBriefSummaries()
                .<Object>map(node -> node)
                .orElseGet(() -> Map.of("briefs", List.of())));
    }

    /** Read a generated brief for one JD = company+role+level+specialization. */
    @GetMapping("/briefs/{company}/{role}/{level}/{specialization}")
    public ResponseEntity<?> brief(
            @PathVariable String company, @PathVariable String role,
            @PathVariable String level, @PathVariable String specialization) {
        return aiServiceClient.fetchBrief(company, role, level, specialization)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(new ApiError("brief_not_found", "no brief for that JD yet")));
    }

    @ExceptionHandler(RestClientException.class)
    public ResponseEntity<ApiError> handleAiServiceDown(RestClientException ex) {
        log.warn("AI service call failed: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(new ApiError("ai_service_unreachable", "the intelligence service is not reachable"));
    }
}
