package com.interviewiq.interviewiq_backend.profile.service;

import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.profile.assembler.ProfileAssembler;
import com.interviewiq.interviewiq_backend.profile.github.GitHubCollector;
import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
import com.interviewiq.interviewiq_backend.profile.model.LeetCodeConnection;
import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
import com.interviewiq.interviewiq_backend.profile.repository.GitHubConnectionRepository;
import com.interviewiq.interviewiq_backend.profile.repository.LeetCodeConnectionRepository;
import com.interviewiq.interviewiq_backend.profile.repository.ProfileFragmentRepository;
import com.interviewiq.interviewiq_backend.profile.web.dto.*;
import com.interviewiq.interviewiq_backend.services.UserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class ProfileService {

    private final UserService userService;
    private final GitHubConnectionRepository connectionRepository;
    private final LeetCodeConnectionRepository leetCodeConnectionRepository;
    private final ProfileFragmentRepository fragmentRepository;
    private final GitHubCollector gitHubCollector;
    private final ProfileAssembler profileAssembler;
    private final ObjectMapper objectMapper;

    public ProfileService(
            UserService userService,
            GitHubConnectionRepository connectionRepository,
            LeetCodeConnectionRepository leetCodeConnectionRepository,
            ProfileFragmentRepository fragmentRepository,
            GitHubCollector gitHubCollector,
            ProfileAssembler profileAssembler,
            ObjectMapper objectMapper) {
        this.userService = userService;
        this.connectionRepository = connectionRepository;
        this.leetCodeConnectionRepository = leetCodeConnectionRepository;
        this.fragmentRepository = fragmentRepository;
        this.gitHubCollector = gitHubCollector;
        this.profileAssembler = profileAssembler;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public ProfileResponse getProfile(UUID userId) {
        User user = userService.getById(userId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown user: " + userId));

        List<ProfileFragment> fragments = fragmentRepository.findByUserId(userId);
        Optional<GitHubConnection> github = connectionRepository.findByUserId(userId);

        ProfileUser profileUser = new ProfileUser(user.getName(), null);

        Optional<LeetCodeConnection> leetcode = leetCodeConnectionRepository.findByUserId(userId);

        List<SourceStatus> sources = new ArrayList<>();
        sources.add(new SourceStatus(
                ProfileSource.GITHUB.name(),
                github.isPresent(),
                github.map(GitHubConnection::getLastRefreshedAt).orElse(null),
                null));
        sources.add(new SourceStatus(ProfileSource.RESUME.name(), false, null, null));
        sources.add(new SourceStatus(
                ProfileSource.LEETCODE.name(),
                leetcode.isPresent(),
                leetcode.map(LeetCodeConnection::getLastRefreshedAt).orElse(null),
                leetcode.map(c -> c.getStatus().name()).orElse(null)));
        sources.add(new SourceStatus(ProfileSource.LINKEDIN.name(), false, null, null));
        sources.add(new SourceStatus(ProfileSource.X.name(), false, null, null));

        ProfileAssembler.Bands bands = profileAssembler.assemble(fragments);

        Map<String, JsonNode> fragmentMap = new LinkedHashMap<>();
        List<ProvenanceItem> provenance = new ArrayList<>();
        for (ProfileFragment fragment : fragments) {
            JsonNode data = objectMapper.readTree(fragment.getData());
            fragmentMap.put(fragment.getSource().name().toLowerCase(), data);
            provenance.add(new ProvenanceItem(
                    fragment.getSource().name(),
                    "sha256:" + fragment.getContentHash(),
                    fragment.getFetchedAt()));
        }

        return new ProfileResponse(
                profileUser,
                sources,
                bands.notable(),
                bands.mostUsedSkills(),
                bands.atAGlance(),
                fragmentMap,
                provenance);
    }

    /** Synchronous fetch-on-connect: collect GitHub data and stamp lastRefreshedAt. */
    @Transactional
    public void refreshGitHub(GitHubConnection connection) {
        gitHubCollector.collectAndStore(connection);
        connection.setLastRefreshedAt(java.time.Instant.now());
        connectionRepository.save(connection);
    }

    @Transactional
    public void disconnectGitHub(UUID userId) {
        connectionRepository.deleteByUserId(userId);
        fragmentRepository.deleteByUserIdAndSource(userId, ProfileSource.GITHUB);
    }
}
