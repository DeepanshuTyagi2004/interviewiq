package com.interviewiq.interviewiq_backend.config;

import com.interviewiq.interviewiq_backend.models.Company;
import com.interviewiq.interviewiq_backend.models.CompanyRoleConfig;
import com.interviewiq.interviewiq_backend.models.JobDescription;
import com.interviewiq.interviewiq_backend.repositories.CompanyRepository;
import com.interviewiq.interviewiq_backend.repositories.CompanyRoleConfigRepository;
import com.interviewiq.interviewiq_backend.repositories.JobDescriptionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;

/**
 * Loads the starter catalogue ON DEMAND (admin "Load starter companies" button) — NOT on
 * startup. MVP scope: Meesho only — 1 brief combo (fresher) + 3 distinct software/IT JD roles
 * (backend / data engineering / android), all fresher. Idempotent: re-running refreshes the
 * seed JDs and HARD-DELETES any non-MVP company's rows. No Flyway — entities + this seeder,
 * ddl-auto handles schema.
 */
@Service
public class CompanyRoleConfigSeeder {

    private static final Logger log = LoggerFactory.getLogger(CompanyRoleConfigSeeder.class);
    private static final String ROLE = "software-engineer";
    private static final String COMPANY = "meesho";
    private static final Set<String> MVP_COMPANIES = Set.of(COMPANY);

    public record SeedResult(int companies, int inserted, int backfilled, int removed, int total) {}

    private record CompanySeed(String name, String slug, Integer tier, String hq, String size) {}

    private record Seed(String company, String level, String title, String url, String description,
                        String requirements, String responsibilities, String techStack, int roundCount) {}

    private static final List<CompanySeed> COMPANIES = List.of(
            new CompanySeed("Meesho", "meesho", 2, "Bengaluru, India", "1,500+")
    );

    private static final List<Seed> SEEDS = List.of(
            new Seed("meesho", "fresher", "Software Development Engineer (SDE I)", "https://www.meesho.io/jobs",
                    "SDE I at Meesho: build and scale the systems behind India's largest e-commerce platform for the next billion users, owning features with mentorship in a high-scale, mobile-first environment.",
                    "0-2 years experience. Strong data structures and algorithms. Proficiency in a programming language (Java, Python, Kotlin, Go, or JavaScript). Eagerness to work on high-scale consumer systems.",
                    "Build and ship features across services and apps; write tested, observable code; participate in design and code reviews; learn to operate systems at scale.",
                    "Java,Python,SQL,Microservices,Data Structures,System Design", 4)
    );

    private static final String CAREERS = "https://www.meesho.io/jobs";

    private record JdSeed(String level, String specialization, String title,
                          String description, String techStack) {}

    /**
     * Three deliberately distinct software/IT JD roles for the fresher level — backend, data
     * engineering, and android — so the level-wise browse + specialization filter offers real
     * variety. The brief (company_role_configs) stays one-per-level and is shared across these —
     * process is level-driven, not role-driven.
     */
    private static final List<JdSeed> JD_SEEDS = List.of(
            new JdSeed("fresher", "backend", "SDE I — Backend",
                    "Build and scale backend services and APIs that power India's largest e-commerce platform for the next billion users, with mentorship at high scale. 0-2 years; strong DSA and a backend language.",
                    "Java,Go,Spring Boot,SQL,Microservices,Data Structures"),
            new JdSeed("fresher", "data-engineering", "Data Engineer I",
                    "Build data pipelines and analytics infrastructure that turn billions of commerce events into insights and ML features for the next billion users. 0-2 years; strong SQL, Python, and DSA.",
                    "Python,SQL,Spark,Airflow,Data Modeling,ETL"),
            new JdSeed("fresher", "android", "SDE I — Android",
                    "Build the Meesho consumer app used by hundreds of millions across India; Kotlin/Android with a relentless focus on performance on low-end devices. 0-2 years; strong DSA and mobile fundamentals.",
                    "Kotlin,Android,Java,REST,Jetpack,Data Structures")
    );

    private final CompanyRoleConfigRepository repository;
    private final CompanyRepository companyRepository;
    private final JobDescriptionRepository jdRepository;

    public CompanyRoleConfigSeeder(CompanyRoleConfigRepository repository,
                                   CompanyRepository companyRepository,
                                   JobDescriptionRepository jdRepository) {
        this.repository = repository;
        this.companyRepository = companyRepository;
        this.jdRepository = jdRepository;
    }

    public SeedResult seed() {
        int companiesSeeded = 0;
        for (CompanySeed cs : COMPANIES) {
            if (companyRepository.findBySlug(cs.slug()).isEmpty()) {
                companyRepository.save(new Company(cs.name(), cs.slug(), cs.tier(), null, cs.hq(), cs.size()));
                companiesSeeded++;
            }
        }

        int inserted = 0;
        int backfilled = 0;
        for (Seed s : SEEDS) {
            var existing = repository.findByCompanyAndRoleAndLevel(s.company(), ROLE, s.level());
            if (existing.isPresent()) {
                CompanyRoleConfig row = existing.get();
                boolean changed = false;
                if (row.getTitle() == null) { row.setTitle(s.title()); changed = true; }
                if (row.getJdUrl() == null) { row.setJdUrl(s.url()); changed = true; }
                if (row.getJdDescription() == null) { row.setJdDescription(s.description()); changed = true; }
                if (row.getRequirements() == null) { row.setRequirements(s.requirements()); changed = true; }
                if (row.getResponsibilities() == null) { row.setResponsibilities(s.responsibilities()); changed = true; }
                if (row.getTechStack() == null) { row.setTechStack(s.techStack()); changed = true; }
                if (row.getRoundCount() == null) { row.setRoundCount(s.roundCount()); changed = true; }
                if (!row.isEnabled()) { row.setEnabled(true); changed = true; }
                if (changed) { repository.save(row); backfilled++; }
            } else {
                CompanyRoleConfig row =
                        new CompanyRoleConfig(s.company(), ROLE, s.level(), s.title(), s.url());
                row.setJdDescription(s.description());
                row.setRequirements(s.requirements());
                row.setResponsibilities(s.responsibilities());
                row.setTechStack(s.techStack());
                row.setRoundCount(s.roundCount());
                repository.save(row);
                inserted++;
            }
        }

        // Enforce MVP scope: REMOVE anything that isn't a target company (combos, JDs, companies).
        int removed = 0;
        var staleCombos = repository.findAll().stream()
                .filter(r -> !MVP_COMPANIES.contains(r.getCompany())).toList();
        repository.deleteAll(staleCombos);
        removed += staleCombos.size();
        var staleJds = jdRepository.findAll().stream()
                .filter(j -> !MVP_COMPANIES.contains(j.getCompany())).toList();
        jdRepository.deleteAll(staleJds);
        removed += staleJds.size();
        var staleCompanies = companyRepository.findAll().stream()
                .filter(c -> !MVP_COMPANIES.contains(c.getSlug())).toList();
        companyRepository.deleteAll(staleCompanies);
        removed += staleCompanies.size();

        // Replace ALL of the company's JDs so re-running is a clean idempotent refresh.
        jdRepository.deleteByCompany(COMPANY);
        int jdsSeeded = 0;
        for (JdSeed j : JD_SEEDS) {
            jdRepository.save(new JobDescription(
                    COMPANY, ROLE, j.level(), j.title(), j.specialization(),
                    j.description(), j.techStack(), CAREERS, "seed"));
            jdsSeeded++;
        }

        log.info("Catalogue seed: {} companies, {} combos inserted, {} backfilled, {} removed (non-MVP), "
                + "{} role-based JDs (across {} brief combos)",
                companiesSeeded, inserted, backfilled, removed, jdsSeeded, SEEDS.size());
        return new SeedResult(companiesSeeded, inserted, backfilled, removed, jdsSeeded);
    }
}
