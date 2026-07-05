package com.interviewiq.interviewiq_backend.models;

/**
 * Interview session lifecycle. Pipeline 1 (interview prep) implements the prep states, and
 * sub-project A (live-interview runtime) implements the live states; the enum is deliberately
 * left EXTENSIBLE for later debrief stages (e.g. DEBRIEF_READY) which are NOT implemented here.
 *
 * <p>Prep state machine:
 * <pre>
 *   SCHEDULED ──(lead-time reached, or manual regenerate)──▶ PREP_QUEUED
 *   PREP_QUEUED ──(ai-service returns a plan)──▶ PREP_READY
 *   PREP_QUEUED ──(generation fails)──▶ PREP_FAILED
 *   PREP_FAILED ──(regenerate)──▶ PREP_QUEUED
 * </pre>
 *
 * <p>Live state machine:
 * <pre>
 *   PREP_READY ──(candidate goes live)──▶ LIVE_IN_PROGRESS
 *   LIVE_IN_PROGRESS ──(worker delivers a natural/early outcome)──▶ COMPLETED
 *   LIVE_IN_PROGRESS ──(worker delivers a technical-failure outcome)──▶ ABORTED_TECHNICAL
 * </pre>
 */
public enum SessionStatus {
    SCHEDULED,
    PREP_QUEUED,
    PREP_READY,
    PREP_FAILED,
    LIVE_IN_PROGRESS,
    COMPLETED,
    ABORTED_TECHNICAL
}
