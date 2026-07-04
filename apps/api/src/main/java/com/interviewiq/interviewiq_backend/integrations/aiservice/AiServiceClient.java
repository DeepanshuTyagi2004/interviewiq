package com.interviewiq.interviewiq_backend.integrations.aiservice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.Optional;

/**
 * HTTP client for interviewiq-ai-service — the home of all LLM logic. This backend
 * never calls an LLM itself; it asks the AI service for pre-generated briefs.
 *
 * <p>The brief JSON is rich/nested (v2: experiences_by_source + consolidated_process),
 * so we pass it through as a {@link JsonNode} rather than mapping to a flat DTO — the
 * JD detail endpoint embeds {@code consolidated_process} directly.
 */
@Service
public class AiServiceClient {

    private static final Logger log = LoggerFactory.getLogger(AiServiceClient.class);

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    private final String internalApiKey;

    public AiServiceClient(
            RestClient restClient,
            ObjectMapper objectMapper,
            @Value("${aiservice.base-url}") String baseUrl,
            @Value("${internal.api-key}") String internalApiKey) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl;
        this.internalApiKey = internalApiKey;
    }

    /**
     * Fetch the full interview brief doc for one JD = company+role+level+specialization.
     * Empty when no brief exists (404) or on transport failure — a degraded AI service
     * never blocks the JD pages or a session. Never throws.
     */
    public Optional<JsonNode> fetchBrief(String company, String role, String level, String specialization) {
        try {
            String body = restClient.get()
                    .uri(baseUrl + "/briefs/{company}/{role}/{level}/{specialization}",
                            company, role, level, specialization)
                    .header("X-Internal-Api-Key", internalApiKey)
                    .retrieve()
                    .body(String.class);
            return Optional.of(objectMapper.readTree(body));
        } catch (HttpClientErrorException.NotFound ex) {
            return Optional.empty();
        } catch (RestClientException ex) {
            log.warn("AI service brief fetch failed for {}/{}/{}/{}: {}",
                    company, role, level, specialization, ex.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Status summary of all briefs ({company, role, level, data_confidence, generation_status}).
     * One call — used to badge the JD list without fetching every full brief. Empty on failure.
     */
    public Optional<JsonNode> listBriefSummaries() {
        try {
            String body = restClient.get()
                    .uri(baseUrl + "/briefs")
                    .header("X-Internal-Api-Key", internalApiKey)
                    .retrieve()
                    .body(String.class);
            return Optional.of(objectMapper.readTree(body));
        } catch (RestClientException ex) {
            log.warn("AI service brief summaries fetch failed: {}", ex.getMessage());
            return Optional.empty();
        }
    }

    /** Trigger a brief-generation run on the AI service. Throws RestClientException on failure. */
    public JsonNode triggerScrape() {
        String body = restClient.post()
                .uri(baseUrl + "/admin/scrape/run")
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    /** Trigger a question-bank collection run on the AI service. Throws on transport failure. */
    public JsonNode collectQuestions() {
        String body = restClient.post()
                .uri(baseUrl + "/admin/questions/collect")
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    /** Cooperatively stop the active ingestion run. Throws on transport failure. */
    public JsonNode stopScrape() {
        String body = restClient.post()
                .uri(baseUrl + "/admin/scrape/stop")
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    /** Delete all generated briefs (destructive admin reset). Throws on transport failure. */
    public JsonNode clearBriefs() {
        String body = restClient.post()
                .uri(baseUrl + "/admin/briefs/clear")
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    /** Submit a first-party (paste-in) interview experience. Throws on transport failure. */
    public JsonNode submitExperience(String company, String role, String level, String rawContent) {
        Map<String, Object> body = Map.of(
                "company", company, "role", role, "level", level, "raw_content", rawContent);
        String response = restClient.post()
                .uri(baseUrl + "/admin/experiences")
                .header("X-Internal-Api-Key", internalApiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(response);
    }

    /** Current pipeline run state + incremental verbose logs (entries with seq &gt; after). */
    public JsonNode getScrapeStatus(long after) {
        String body = restClient.get()
                .uri(baseUrl + "/admin/scrape/status?after={after}", after)
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    /** List ingested questions (metadata bank) for the admin console. Empty on failure. */
    public Optional<JsonNode> listQuestions(String roundType, String company, String difficulty, int limit) {
        try {
            StringBuilder uri = new StringBuilder(baseUrl + "/questions?limit=" + limit);
            if (roundType != null && !roundType.isBlank()) uri.append("&round_type=").append(roundType);
            if (company != null && !company.isBlank()) uri.append("&company=").append(company);
            if (difficulty != null && !difficulty.isBlank()) uri.append("&difficulty=").append(difficulty);
            String body = restClient.get()
                    .uri(uri.toString())
                    .header("X-Internal-Api-Key", internalApiKey)
                    .retrieve()
                    .body(String.class);
            return Optional.of(objectMapper.readTree(body));
        } catch (RestClientException ex) {
            log.warn("AI service question list failed: {}", ex.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Parse a résumé PDF into structured JSON (onboarding). Sends the raw PDF bytes
     * (Content-Type: application/pdf); the ai-service does the text extraction + LLM parse and
     * returns snake_case JSON, which the caller maps onto the CandidateProfile DTOs.
     *
     * <p>Unlike {@link #fetchBrief}, this does NOT swallow failures: a failed parse (e.g. 422 for a
     * scanned/image-only PDF, or a 502 LLM error) must reach the user so they can retry or enter
     * their details manually. Throws {@link org.springframework.web.client.RestClientResponseException}
     * on a non-2xx upstream response and {@link RestClientException} on transport failure.
     */
    public String parseResume(byte[] pdfBytes) {
        String body = restClient.post()
                .uri(baseUrl + "/resumes/parse")
                .header("X-Internal-Api-Key", internalApiKey)
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes)
                .retrieve()
                .body(String.class);
        if (body == null || body.isBlank()) {
            // A 2xx with an empty body is a broken upstream — surface it as a transport failure
            // (the caller maps RestClientException to 502) rather than feeding null to the JSON mapper.
            throw new RestClientException("ai-service /resumes/parse returned an empty body");
        }
        return body;
    }

    /**
     * Build (or fetch the cached) InterviewPlan for a session (Interview Prep, Pipeline 1). The
     * caller assembles {@code request} (session context + JD + candidate profile) and this posts it
     * to the ai-service, which caches on a fused input hash — an identical re-request returns the
     * stored plan with no LLM calls.
     *
     * <p>Like {@link #parseResume}, this does NOT swallow failures: the caller (the prep trigger)
     * catches them, moves the session to {@code PREP_FAILED}, and logs. Throws
     * {@link org.springframework.web.client.RestClientResponseException} on a non-2xx upstream
     * response and {@link RestClientException} on transport failure.
     */
    public JsonNode generateInterviewPlan(GenerateInterviewPlanRequest request) {
        String response = restClient.post()
                .uri(baseUrl + "/interview-plans")
                .header("X-Internal-Api-Key", internalApiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(request)
                .retrieve()
                .body(String.class);
        if (response == null || response.isBlank()) {
            throw new RestClientException("ai-service /interview-plans returned an empty body");
        }
        return objectMapper.readTree(response);
    }

    /**
     * Fire-and-poll variant of {@link #generateInterviewPlan}: start plan generation in the
     * background on the ai-service and get a {@code run_id} back immediately. The caller then polls
     * {@link #getInterviewPlanRun(String)} until the run is terminal. This keeps every HTTP call
     * short so a slow, concurrent Stage-2 LLM run can't trip the client read timeout (which would
     * wrongly mark the session PREP_FAILED). Same request body + cache/persist semantics as the
     * synchronous route. Returns the run id; throws on non-2xx / transport failure.
     */
    public String startInterviewPlan(GenerateInterviewPlanRequest request) {
        String response = restClient.post()
                .uri(baseUrl + "/interview-plans/start")
                .header("X-Internal-Api-Key", internalApiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(request)
                .retrieve()
                .body(String.class);
        if (response == null || response.isBlank()) {
            throw new RestClientException("ai-service /interview-plans/start returned an empty body");
        }
        JsonNode runIdNode = objectMapper.readTree(response).path("run_id");
        String runId = runIdNode.isMissingNode() || runIdNode.isNull() ? null : runIdNode.asString();
        if (runId == null || runId.isBlank()) {
            throw new RestClientException("ai-service /interview-plans/start returned no run_id");
        }
        return runId;
    }

    /**
     * Poll a run started by {@link #startInterviewPlan}. Returns the run snapshot
     * {@code {run_id, status, plan, error}} where status is {@code running | completed | failed}.
     * Throws {@link HttpClientErrorException.NotFound} if the run is unknown (evicted / never
     * existed) and {@link RestClientException} on transport failure — the caller decides how to map.
     */
    public JsonNode getInterviewPlanRun(String runId) {
        String body = restClient.get()
                .uri(baseUrl + "/interview-plans/runs/{runId}", runId)
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        if (body == null || body.isBlank()) {
            throw new RestClientException("ai-service /interview-plans/runs returned an empty body");
        }
        return objectMapper.readTree(body);
    }

    // --- Résumé-parse observability console (admin test-bench) -----------------------------------

    /**
     * Start an instrumented résumé-parse run on the ai-service (admin bench). Sends the raw PDF
     * bytes (same content-type contract as {@link #parseResume}); the run executes in the
     * background and the response is {@code {run_id, status}}. Throws on non-2xx / transport error.
     */
    public JsonNode startResumeParseRun(byte[] pdfBytes, String filename) {
        String body = restClient.post()
                .uri(baseUrl + "/admin/resume/parse/run?filename={filename}", filename)
                .header("X-Internal-Api-Key", internalApiKey)
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes)
                .retrieve()
                .body(String.class);
        if (body == null || body.isBlank()) {
            throw new RestClientException("ai-service /admin/resume/parse/run returned an empty body");
        }
        return objectMapper.readTree(body);
    }

    /** Snapshot of one résumé-parse run + incremental logs (entries with seq &gt; after). */
    public JsonNode getResumeParseRun(String runId, long after) {
        String body = restClient.get()
                .uri(baseUrl + "/admin/resume/parse/runs/{runId}?after={after}", runId, after)
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    /** Recent résumé-parse runs (newest first). */
    public JsonNode listResumeParseRuns() {
        String body = restClient.get()
                .uri(baseUrl + "/admin/resume/parse/runs")
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    // --- Interview-prep observability console (admin test-bench) ---------------------------------

    /**
     * Start an instrumented interview-prep run on the ai-service (admin bench). Sends the same
     * request body as {@link #generateInterviewPlan}; the run executes in the background (cache
     * bypassed, plan not persisted) and the response is {@code {run_id, status}}.
     */
    public JsonNode startInterviewPrepRun(GenerateInterviewPlanRequest request) {
        String body = restClient.post()
                .uri(baseUrl + "/admin/interview-prep/run")
                .header("X-Internal-Api-Key", internalApiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(request)
                .retrieve()
                .body(String.class);
        if (body == null || body.isBlank()) {
            throw new RestClientException("ai-service /admin/interview-prep/run returned an empty body");
        }
        return objectMapper.readTree(body);
    }

    /** Snapshot of one interview-prep run + incremental logs (entries with seq &gt; after). */
    public JsonNode getInterviewPrepRun(String runId, long after) {
        String body = restClient.get()
                .uri(baseUrl + "/admin/interview-prep/runs/{runId}?after={after}", runId, after)
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }

    /** Recent interview-prep runs (newest first). */
    public JsonNode listInterviewPrepRuns() {
        String body = restClient.get()
                .uri(baseUrl + "/admin/interview-prep/runs")
                .header("X-Internal-Api-Key", internalApiKey)
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(body);
    }
}
