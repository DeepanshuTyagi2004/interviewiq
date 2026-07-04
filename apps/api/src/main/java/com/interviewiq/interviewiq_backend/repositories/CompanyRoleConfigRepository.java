package com.interviewiq.interviewiq_backend.repositories;

import com.interviewiq.interviewiq_backend.models.CompanyRoleConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface CompanyRoleConfigRepository extends JpaRepository<CompanyRoleConfig, UUID> {
    List<CompanyRoleConfig> findAllByEnabledTrue();

    List<CompanyRoleConfig> findAllByOrderByCompanyAscLevelAsc();

    Optional<CompanyRoleConfig> findByCompanyAndRoleAndLevel(String company, String role, String level);

    boolean existsByCompany(String company);

    @Transactional
    void deleteByCompany(String company);
}
