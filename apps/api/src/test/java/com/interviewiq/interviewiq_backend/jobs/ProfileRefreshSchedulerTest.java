package com.interviewiq.interviewiq_backend.jobs;

import com.interviewiq.interviewiq_backend.models.GitHubConnection;
import com.interviewiq.interviewiq_backend.repositories.GitHubConnectionRepository;
import com.interviewiq.interviewiq_backend.services.ProfileService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.UUID;

import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProfileRefreshSchedulerTest {

    @Mock
    private GitHubConnectionRepository connectionRepository;

    @Mock
    private ProfileService profileService;

    @InjectMocks
    private ProfileRefreshScheduler scheduler;

    private GitHubConnection connection(String login) {
        GitHubConnection c = new GitHubConnection(UUID.randomUUID(), login, "enc-token", "repo");
        return c;
    }

    @Test
    void refreshAllGitHubConnections_callsRefreshOncePerConnection() {
        GitHubConnection c1 = connection("alice");
        GitHubConnection c2 = connection("bob");
        when(connectionRepository.findAll()).thenReturn(List.of(c1, c2));

        scheduler.refreshAllGitHubConnections();

        verify(profileService, times(1)).refreshGitHub(c1);
        verify(profileService, times(1)).refreshGitHub(c2);
        verifyNoMoreInteractions(profileService);
    }

    @Test
    @MockitoSettings(strictness = Strictness.LENIENT)
    void refreshAllGitHubConnections_exceptionOnOneConnection_continuesForRest() {
        GitHubConnection c1 = connection("alice");
        GitHubConnection c2 = connection("bob");
        GitHubConnection c3 = connection("carol");
        when(connectionRepository.findAll()).thenReturn(List.of(c1, c2, c3));
        // second connection throws a RuntimeException
        doThrow(new RuntimeException("GitHub API timeout")).when(profileService).refreshGitHub(c2);

        // must not throw
        scheduler.refreshAllGitHubConnections();

        // c1 and c3 were still refreshed despite c2 failing
        verify(profileService, times(1)).refreshGitHub(c1);
        verify(profileService, times(1)).refreshGitHub(c2);
        verify(profileService, times(1)).refreshGitHub(c3);
    }

    @Test
    void refreshAllGitHubConnections_noConnections_doesNotCallRefresh() {
        when(connectionRepository.findAll()).thenReturn(List.of());

        scheduler.refreshAllGitHubConnections();

        verifyNoInteractions(profileService);
    }
}
