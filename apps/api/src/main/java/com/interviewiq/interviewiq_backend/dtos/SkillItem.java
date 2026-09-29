package com.interviewiq.interviewiq_backend.dtos;

/**
 * A most-used skill. {@code evidence} keeps the cross-source attribution (CLAUDE.md hard rule —
 * every skill carries evidence), even though the UI renders skills as bare tags. {@code source}
 * is the originating source name (e.g. "GITHUB" / "LEETCODE") so the UI can show a source icon.
 */
public record SkillItem(String skill, String evidence, String source) {
}
