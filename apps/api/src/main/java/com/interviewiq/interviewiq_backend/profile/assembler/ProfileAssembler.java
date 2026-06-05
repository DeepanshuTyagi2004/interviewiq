package com.interviewiq.interviewiq_backend.profile.assembler;

import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
import com.interviewiq.interviewiq_backend.profile.web.dto.NotableItem;
import com.interviewiq.interviewiq_backend.profile.web.dto.SkillItem;

import java.util.List;

/**
 * Produces descriptive (never scored/ranked) profile bands from fragments.
 * Isolated behind this interface so the real synthesis service can replace
 * the rule-based stand-in without touching controllers or DTOs.
 */
public interface ProfileAssembler {

    Bands assemble(List<ProfileFragment> fragments);

    record Bands(
            List<NotableItem> notable,
            List<SkillItem> mostUsedSkills,
            List<String> atAGlance
    ) {
    }
}
