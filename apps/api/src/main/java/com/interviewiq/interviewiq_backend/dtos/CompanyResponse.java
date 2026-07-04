package com.interviewiq.interviewiq_backend.dtos;

public record CompanyResponse(
        String id,
        String name,
        String slug,
        Integer tier,
        String logoUrl,
        String headquarterLocation,
        String companySize
) {
}
