package com.interviewiq.interviewiq_backend.models;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A booked mock-interview session and its prep readiness (Pipeline 1). One row per booking:
 * a candidate picks a JD + round + slot, and a scheduled job builds the interviewer's
 * {@link InterviewSession} prep plan (stored in the ai-service) shortly before the slot.
 *
 * <p>The company/role/level/specialization are copied from the {@link JobDescription} at booking
 * time (the brief + question bank are keyed on those, and the JD could change later). {@code
 * candidateId} is the authenticated user's id. Only the prep-reference bits ({@code planVersion},
 * {@code inputHash}) live here — the plan itself is the interviewer's material, held by the
 * ai-service. Prep-only: no live-session or debrief columns (that's a later pipeline).
 */
@Entity
@Table(name = "interview_sessions", indexes = {
        @Index(name = "idx_session_candidate", columnList = "candidate_id"),
        // Drives the scheduled poller: due SCHEDULED sessions by slot.
        @Index(name = "idx_session_status_scheduled", columnList = "status, scheduled_at"),
})
@Getter
@Setter
@NoArgsConstructor
public class InterviewSession {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(updatable = false, nullable = false)
    private UUID id;

    @Column(name = "candidate_id", nullable = false)
    private UUID candidateId;

    @Column(name = "job_description_id", nullable = false)
    private UUID jobDescriptionId;

    // Copied from the JD at booking (the brief + questions are keyed on these).
    @Column(nullable = false)
    private String company;

    @Column(nullable = false)
    private String role;

    @Column(nullable = false, length = 16)
    private String level;

    @Column(length = 32)
    private String specialization;

    @Convert(converter = RoundTypeConverter.class)
    @Column(name = "round_type", nullable = false, length = 32)
    private RoundType roundType;

    /** The chosen slot as an absolute instant (UTC); {@code timezone} records what the user booked in. */
    @Column(name = "scheduled_at", nullable = false)
    private Instant scheduledAt;

    @Column(nullable = false, length = 64)
    private String timezone;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private SessionStatus status = SessionStatus.SCHEDULED;

    // Prep reference, set once the ai-service returns a plan.
    @Column(name = "plan_version")
    private String planVersion;

    @Column(name = "input_hash")
    private String inputHash;

    /** Stable error code when status == PREP_FAILED (else null). */
    @Column(name = "prep_error")
    private String prepError;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "live_started_at")
    private Instant liveStartedAt;

    @Column(name = "live_ended_at")
    private Instant liveEndedAt;

    @Column(name = "ended_reason", length = 32)
    private String endedReason;

    @Column(name = "livekit_room")
    private String livekitRoom;

    @Column(name = "live_score_final")
    private Double liveScoreFinal;

    @Column(name = "duration_s")
    private Integer durationS;

    // Full SessionOutcome JSON from the worker, stored verbatim. Null until the interview finalizes.
    // Relies on hikari stringtype=unspecified for the String->jsonb cast (see application.properties).
    @Column(name = "outcome", columnDefinition = "jsonb")
    private String outcome;

    public InterviewSession(UUID candidateId, JobDescription jd, RoundType roundType,
                            Instant scheduledAt, String timezone) {
        this.candidateId = candidateId;
        this.jobDescriptionId = jd.getId();
        this.company = jd.getCompany();
        this.role = jd.getRole();
        this.level = jd.getLevel();
        this.specialization = jd.getSpecialization();
        this.roundType = roundType;
        this.scheduledAt = scheduledAt;
        this.timezone = timezone;
        this.status = SessionStatus.SCHEDULED;
    }

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        this.updatedAt = Instant.now();
    }

    public boolean isPlanReady() {
        return this.status == SessionStatus.PREP_READY;
    }
}
