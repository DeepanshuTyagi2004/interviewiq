package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.dtos.CompanyWithJds;
import com.interviewiq.interviewiq_backend.dtos.CreateCompanyRequest;
import com.interviewiq.interviewiq_backend.dtos.JdRequest;
import com.interviewiq.interviewiq_backend.dtos.JdResponse;
import com.interviewiq.interviewiq_backend.config.CompanyRoleConfigSeeder;
import com.interviewiq.interviewiq_backend.integrations.aiservice.AiServiceClient;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.repositories.CompanyRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Admin catalogue management for the ingestion page: add a company + its JDs, list the
 * catalogue, and delete a company. The catalogue IS the {@code job_descriptions} table —
 * the same role-based JDs the student Jobs page shows and the brief pipeline targets.
 * Adding a company kicks off ingestion so the admin can watch it live. ADMIN-gated by
 * SecurityConfig ({@code /api/v1/admin/**}).
 */
@RestController
@RequestMapping(value = "/api/{version}/admin/companies", version = "1")
public class AdminCompanyController {

    private static final Logger log = LoggerFactory.getLogger(AdminCompanyController.class);
    private static final Set<String> VALID_LEVELS = Set.of("fresher", "sde1", "sde2", "sde3");
    private static final String DEFAULT_ROLE = "software-engineer";
    private static final String DEFAULT_SPECIALIZATION = "general";

    private final JobDescriptionRepository jdRepository;
    private final CompanyRepository companyRepository;
    private final AiServiceClient aiServiceClient;
    private final CompanyRoleConfigSeeder seeder;

    public AdminCompanyController(
            JobDescriptionRepository jdRepository,
            CompanyRepository companyRepository,
            AiServiceClient aiServiceClient,
            CompanyRoleConfigSeeder seeder) {
        this.jdRepository = jdRepository;
        this.companyRepository = companyRepository;
        this.aiServiceClient = aiServiceClient;
        this.seeder = seeder;
    }

    /** Load the starter catalogue (Razorpay, 9 role-based JDs) on demand. Idempotent.
     *  Does NOT trigger ingestion — that's a separate explicit step ("Run ingestion"). */
    @PostMapping("/seed")
    public CompanyRoleConfigSeeder.SeedResult seed() {
        return seeder.seed();
    }

    @GetMapping
    public List<CompanyWithJds> list() {
        Map<String, List<JdResponse>> byCompany = new LinkedHashMap<>();
        for (JobDescription j : jdRepository.findAllByActiveTrueOrderByCompanyAscLevelAsc()) {
            byCompany.computeIfAbsent(j.getCompany(), k -> new ArrayList<>())
                    .add(new JdResponse(j.getId().toString(), j.getRole(), j.getLevel(),
                            j.getSpecialization(), j.getTitle(), j.getSourceUrl(),
                            j.getDescription(), j.isActive()));
        }
        return byCompany.entrySet().stream()
                .map(e -> new CompanyWithJds(e.getKey(), e.getValue()))
                .toList();
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody CreateCompanyRequest request) {
        if (request == null || isBlank(request.company()) || request.jds() == null || request.jds().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(new ApiError("invalid_company", "company and at least one JD are required"));
        }
        String company = slug(request.company());
        List<JdResponse> saved = new ArrayList<>();
        for (JdRequest jd : request.jds()) {
            if (jd == null || isBlank(jd.title()) || isBlank(jd.level())) {
                return ResponseEntity.badRequest()
                        .body(new ApiError("invalid_jd", "each JD needs a title and a level"));
            }
            String level = jd.level().trim().toLowerCase();
            if (!VALID_LEVELS.contains(level)) {
                return ResponseEntity.badRequest()
                        .body(new ApiError("invalid_level", "level must be one of " + VALID_LEVELS));
            }
            String role = isBlank(jd.role()) ? DEFAULT_ROLE : slug(jd.role());
            String specialization = isBlank(jd.specialization())
                    ? DEFAULT_SPECIALIZATION : jd.specialization().trim().toLowerCase();

            JobDescription persisted = jdRepository.save(new JobDescription(
                    company, role, level, jd.title().trim(), specialization,
                    isBlank(jd.description()) ? null : jd.description().trim(),
                    null, isBlank(jd.jdUrl()) ? null : jd.jdUrl().trim(), "seed"));
            saved.add(new JdResponse(persisted.getId().toString(), role, level, specialization,
                    persisted.getTitle(), persisted.getSourceUrl(), persisted.getDescription(), true));
        }

        // Kick off ingestion so Perplexity collects for the new JDs; non-fatal if AI service is down.
        boolean ingestionTriggered = true;
        try {
            aiServiceClient.triggerScrape();
        } catch (RestClientException ex) {
            ingestionTriggered = false;
            log.warn("Added {} JD(s) for {} but could not trigger ingestion: {}",
                    saved.size(), company, ex.getMessage());
        }

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "company", company, "jds", saved, "ingestion_triggered", ingestionTriggered));
    }

    @DeleteMapping("/{company}")
    public ResponseEntity<Void> delete(@PathVariable String company) {
        String slug = slug(company);
        jdRepository.deleteByCompany(slug);
        companyRepository.findBySlug(slug).ifPresent(companyRepository::delete);
        return ResponseEntity.noContent().build();
    }

    private static String slug(String s) {
        return s.trim().toLowerCase().replaceAll("\\s+", "-");
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
