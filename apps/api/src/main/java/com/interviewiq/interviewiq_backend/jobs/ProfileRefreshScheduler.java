package com.interviewiq.interviewiq_backend.jobs;

import com.interviewiq.interviewiq_backend.models.GitHubConnection;
import com.interviewiq.interviewiq_backend.repositories.GitHubConnectionRepository;
import com.interviewiq.interviewiq_backend.services.ProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ProfileRefreshScheduler {

    private static final Logger log = LoggerFactory.getLogger(ProfileRefreshScheduler.class);

    private final GitHubConnectionRepository connectionRepository;
    private final ProfileService profileService;

    public ProfileRefreshScheduler(
            GitHubConnectionRepository connectionRepository,
            ProfileService profileService) {
        this.connectionRepository = connectionRepository;
        this.profileService = profileService;
    }

    /** Weekly background refresh of every GitHub connection. fixedRate = 7 days in ms. */
    @Scheduled(fixedRate = 7L * 24 * 60 * 60 * 1000, initialDelay = 60_000)
    public void refreshAllGitHubConnections() {
        List<GitHubConnection> connections = connectionRepository.findAll();
        log.info("Weekly GitHub refresh starting for {} connection(s)", connections.size());
        for (GitHubConnection connection : connections) {
            try {
                profileService.refreshGitHub(connection);
            } catch (RuntimeException ex) {
                // never log the token; log only the (non-sensitive) login + message
                log.warn("GitHub refresh failed for login={}: {}",
                        connection.getGithubLogin(), ex.getMessage());
            }
        }
        log.info("Weekly GitHub refresh complete");
    }
}
