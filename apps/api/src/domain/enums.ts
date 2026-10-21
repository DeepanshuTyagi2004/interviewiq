import { InvalidArgumentError } from "../lib/errors.js";
import { ENGINEERING_LEVELS } from "./engineeringLevels.js";

/** Coarse authorization role, carried in the access token's `role` claim. */
export const ROLES = ["USER", "CANDIDATE", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Lifecycle of a source connection's background collection.
 * SYNCING – in progress · SYNCED – current · FAILED – last run failed (fragment untouched) ·
 * DEGRADED – upstream profile became unavailable; last-known-good fragment kept.
 */
export const SYNC_STATUSES = ["SYNCING", "SYNCED", "FAILED", "DEGRADED"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Profile Builder sources. Fragment keys in API responses are the lower-cased names. */
export const PROFILE_SOURCES = ["GITHUB", "RESUME", "LEETCODE", "CODEFORCES", "CODECHEF", "ATCODER", "HACKEREARTH", "TUF", "ICPC", "COMPETITIVE_PROGRAMMING", "LINKEDIN"] as const;
export type ProfileSource = (typeof PROFILE_SOURCES)[number];

/** Handle-based coding platforms collected through the shared platform connection (`docs/sources/platform-analyzers.md`). */
export const CODING_PLATFORMS = ["CODEFORCES", "CODECHEF", "ATCODER", "TUF"] as const;
export type CodingPlatform = (typeof CODING_PLATFORMS)[number];

/**
 * Interview session lifecycle.
 *
 * Prep:  SCHEDULED → PREP_QUEUED (at booking) → PREP_READY | PREP_FAILED;  PREP_FAILED → (retry) → PREP_QUEUED.
 *        A ready session can be re-prepared in place (prep_refreshing) when its inputs change.
 * Live:  PREP_READY → LIVE_IN_PROGRESS → COMPLETED | ABORTED_TECHNICAL
 *
 * Deliberately extensible for later debrief stages (not implemented here).
 */
export const SESSION_STATUSES = [
  "SCHEDULED",
  "PREP_QUEUED",
  "PREP_READY",
  "PREP_FAILED",
  "LIVE_IN_PROGRESS",
  "COMPLETED",
  "ABORTED_TECHNICAL",
  "CANCELLED",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * The interview round being prepped. Wire values mirror the ai-service `RoundType` enum and
 * `contracts/openapi.yaml` exactly (e.g. `system-design`) — that hyphenated form is what crosses
 * every service boundary and what is persisted. Live, human-conducted rounds only (no OA).
 */
export const ROUND_TYPES = ["dsa", "system-design", "lld", "behavioural", "hiring-manager"] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

/** The round a booking gets when none is specified (the first round). */
export const DEFAULT_ROUND_TYPE: RoundType = "dsa";

/** Parse a wire value (case-insensitive). Throws InvalidArgumentError on an unknown round. */
export function roundTypeFromValue(raw: unknown): RoundType {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new InvalidArgumentError("roundType is required");
  }
  const v = raw.trim().toLowerCase();
  const match = ROUND_TYPES.find((t) => t === v);
  if (!match) throw new InvalidArgumentError(`invalid roundType: ${raw}`);
  return match;
}

/** A request's optional roundType: absent/null → null, otherwise it must be a valid wire value. */
export function optionalRoundType(raw: unknown): RoundType | null {
  return raw === undefined || raw === null ? null : roundTypeFromValue(raw);
}

/** Interview-experience levels. */
export const LEVELS = ENGINEERING_LEVELS;
