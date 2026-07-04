package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.CompanyResponse;
import com.interviewiq.interviewiq_backend.repositories.CompanyRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Supported companies for the JD library. JWT-authed. */
@RestController
@RequestMapping(value = "/api/{version}/companies", version = "1")
public class CompanyController {

    private final CompanyRepository companyRepository;

    public CompanyController(CompanyRepository companyRepository) {
        this.companyRepository = companyRepository;
    }

    @GetMapping
    public List<CompanyResponse> list() {
        return companyRepository.findAll().stream()
                .map(c -> new CompanyResponse(
                        c.getId().toString(), c.getName(), c.getSlug(), c.getTier(),
                        c.getLogoUrl(), c.getHeadquarterLocation(), c.getCompanySize()))
                .toList();
    }
}
