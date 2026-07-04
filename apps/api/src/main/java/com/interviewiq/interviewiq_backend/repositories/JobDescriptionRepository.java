package com.interviewiq.interviewiq_backend.repositories;

import com.interviewiq.interviewiq_backend.models.JobDescription;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Repository
public interface JobDescriptionRepository extends JpaRepository<JobDescription, UUID> {

    List<JobDescription> findAllByActiveTrueOrderByCompanyAscLevelAsc();

    /** Remove ALL of a company's JDs (used on re-seed and on catalogue delete). */
    @Transactional
    void deleteByCompany(String company);
}
