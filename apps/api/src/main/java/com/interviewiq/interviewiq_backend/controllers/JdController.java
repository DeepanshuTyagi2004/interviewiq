package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.JdDetailResponse;
import com.interviewiq.interviewiq_backend.dtos.JdSummaryResponse;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.models.Company;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.repositories.CompanyRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Student-facing JD library (Module 3). Lists the real postings (many per company+level,
 * shown experience-level-wise) from {@code job_descriptions}; the detail embeds the
 * interview process from the brief keyed per-JD by (company, role, level, specialization).
 * JWT-authed.
 */
@RestController
@RequestMapping(value = "/api/{version}/jds", version = "1")
public class JdController {

    private final JobDescriptionRepository jdRepository;
    private final CompanyRepository companyRepository;
    private final AiServiceClient aiServiceClient;

    public JdController(JobDescriptionRepository jdRepository,
                        CompanyRepository companyRepository,
                        AiServiceClient aiServiceClient) {
        this.jdRepository = jdRepository;
        this.companyRepository = companyRepository;
        this.aiServiceClient = aiServiceClient;
    }

    @GetMapping
    public List<JdSummaryResponse> list(
            @RequestParam(required = false) String company,
            @RequestParam(required = false) String level,
            @RequestParam(required = false) String specialization) {
        Map<String, String> companyNames = companyRepository.findAll().stream()
                .collect(Collectors.toMap(Company::getSlug, Company::getName, (a, b) -> a));
        Map<String, String> confidence = loadConfidence();

        return jdRepository.findAllByActiveTrueOrderByCompanyAscLevelAsc().stream()
                .filter(j -> company == null || company.equalsIgnoreCase(j.getCompany()))
                .filter(j -> level == null || level.equalsIgnoreCase(j.getLevel()))
                .filter(j -> specialization == null || specialization.equalsIgnoreCase(j.getSpecialization()))
                .map(j -> {
                    String conf = confidence.get(
                            key(j.getCompany(), j.getRole(), j.getLevel(), j.getSpecialization()));
                    return new JdSummaryResponse(
                            j.getId().toString(), j.getCompany(),
                            companyNames.getOrDefault(j.getCompany(), j.getCompany()),
                            j.getRole(), j.getLevel(), j.getTitle(), j.getSpecialization(),
                            conf, availability(conf));
                })
                .toList();
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> detail(@PathVariable UUID id) {
        Optional<JobDescription> opt = jdRepository.findById(id);
        if (opt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError("jd_not_found", "no JD with that id"));
        }
        JobDescription j = opt.get();
        String companyName = companyRepository.findBySlug(j.getCompany())
                .map(Company::getName).orElse(j.getCompany());

        JsonNode process = null;
        String conf = null;
        List<String> sources = List.of();
        Optional<JsonNode> brief = aiServiceClient.fetchBrief(
                j.getCompany(), j.getRole(), j.getLevel(), j.getSpecialization());
        if (brief.isPresent()) {
            JsonNode b = brief.get();
            JsonNode cp = b.path("consolidated_process");
            process = cp.isMissingNode() || cp.isNull() ? null : cp;
            conf = textOrNull(b, "data_confidence");
            sources = stringList(b.path("sources"));
        }

        return ResponseEntity.ok(new JdDetailResponse(
                j.getId().toString(), j.getCompany(), companyName, j.getRole(), j.getLevel(),
                j.getTitle(), j.getSpecialization(), j.getDescription(), splitCsv(j.getTechStack()),
                j.getSourceUrl(), conf, availability(conf), process, sources));
    }

    // --- helpers ---------------------------------------------------------------

    private Map<String, String> loadConfidence() {
        Map<String, String> map = new HashMap<>();
        aiServiceClient.listBriefSummaries().ifPresent(node -> {
            for (JsonNode b : node.path("briefs")) {
                map.put(key(b.path("company").asString(""), b.path("role").asString(""),
                        b.path("level").asString(""), b.path("specialization").asString("")),
                        textOrNull(b, "data_confidence"));
            }
        });
        return map;
    }

    private static String key(String company, String role, String level, String specialization) {
        return company + "|" + role + "|" + level + "|" + specialization;
    }

    private static String availability(String confidence) {
        if (confidence == null) return "none";
        return switch (confidence) {
            case "high" -> "rich";
            case "medium" -> "available";
            case "low" -> "limited";
            default -> "none";
        };
    }

    private static List<String> splitCsv(String csv) {
        if (csv == null || csv.isBlank()) return List.of();
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    private static String textOrNull(JsonNode n, String field) {
        JsonNode v = n.path(field);
        return v.isNull() || v.isMissingNode() ? null : v.asString("");
    }

    private static List<String> stringList(JsonNode arr) {
        if (arr == null || !arr.isArray()) return List.of();
        java.util.List<String> out = new java.util.ArrayList<>();
        for (JsonNode item : arr) out.add(item.asString(""));
        return out;
    }
}
