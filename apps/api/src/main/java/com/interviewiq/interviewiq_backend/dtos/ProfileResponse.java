package com.interviewiq.interviewiq_backend.dtos;

import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

public record ProfileResponse(
        ProfileUser user,
        List<SourceStatus> sources,
        List<NotableItem> notable,
        List<SkillItem> mostUsedSkills,
        List<String> atAGlance,
        Map<String, JsonNode> fragments,
        List<ProvenanceItem> provenance
) {
}
