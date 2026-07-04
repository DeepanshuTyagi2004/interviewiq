package com.interviewiq.interviewiq_backend.models;

/**
 * Interview session lifecycle. Pipeline 1 (interview prep) implements only the prep states; the
 * enum is deliberately left EXTENSIBLE for later live / debrief stages (e.g. LIVE_IN_PROGRESS,
 * DEBRIEF_READY) which are NOT implemented here.
 *
 * <p>Prep state machine:
 * <pre>
 *   SCHEDULED ──(lead-time reached, or manual regenerate)──▶ PREP_QUEUED
 *   PREP_QUEUED ──(ai-service returns a plan)──▶ PREP_READY
 *   PREP_QUEUED ──(generation fails)──▶ PREP_FAILED
 *   PREP_FAILED ──(regenerate)──▶ PREP_QUEUED
 * </pre>
 */
public enum SessionStatus {
    SCHEDULED,
    PREP_QUEUED,
    PREP_READY,
    PREP_FAILED
}
