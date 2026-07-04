package com.interviewiq.interviewiq_backend.models;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * The interview round being prepped. Wire values mirror the ai-service {@code RoundType} enum and
 * the {@code contracts/openapi.yaml} enum exactly (e.g. {@code system-design}) — that hyphenated
 * form is what crosses every service boundary, so it is the JSON value and the persisted value
 * (see {@link RoundTypeConverter}), not the Java constant name.
 */
public enum RoundType {
    // Live, human-conducted rounds only. Online Assessment is intentionally excluded — it's an
    // automated coding test, not a live round InterviewIQ mocks. DSA is first = the default round
    // assigned at booking (candidates don't pick their round; per-candidate progression comes later).
    DSA("dsa"),
    SYSTEM_DESIGN("system-design"),
    LLD("lld"),
    BEHAVIOURAL("behavioural"),
    HIRING_MANAGER("hiring-manager");

    /** The default round a booking gets when none is specified (the first round). */
    public static final RoundType DEFAULT = DSA;

    private final String value;

    RoundType(String value) {
        this.value = value;
    }

    /** The wire/persisted value (e.g. "system-design"). Used by Jackson to serialize. */
    @JsonValue
    public String value() {
        return value;
    }

    /** Parse a wire value (case-insensitive). Throws IllegalArgumentException on an unknown round. */
    @JsonCreator
    public static RoundType fromValue(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("roundType is required");
        }
        String v = raw.trim().toLowerCase();
        for (RoundType t : values()) {
            if (t.value.equals(v)) {
                return t;
            }
        }
        throw new IllegalArgumentException("invalid roundType: " + raw);
    }
}
