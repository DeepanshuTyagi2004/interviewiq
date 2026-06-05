package com.interviewiq.interviewiq_backend.profile.github;

import com.interviewiq.interviewiq_backend.profile.crypto.TokenCipher;
import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
import com.interviewiq.interviewiq_backend.profile.repository.GitHubConnectionRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.UUID;

@Service
public class GitHubOAuthService {

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final TokenCipher tokenCipher;
    private final GitHubConnectionRepository connectionRepository;
    private final OAuthStateService stateService;

    private final String clientId;
    private final String clientSecret;
    private final String scope;
    private final String authorizeUrl;
    private final String tokenUrl;
    private final String callbackUrl;

    public GitHubOAuthService(
            RestClient restClient,
            ObjectMapper objectMapper,
            TokenCipher tokenCipher,
            GitHubConnectionRepository connectionRepository,
            OAuthStateService stateService,
            @Value("${github.oauth.client-id}") String clientId,
            @Value("${github.oauth.client-secret}") String clientSecret,
            @Value("${github.oauth.scope}") String scope,
            @Value("${github.oauth.authorize-url}") String authorizeUrl,
            @Value("${github.oauth.token-url}") String tokenUrl,
            @Value("${github.oauth.callback-url}") String callbackUrl) {
        this.restClient = restClient;
        this.objectMapper = objectMapper;
        this.tokenCipher = tokenCipher;
        this.connectionRepository = connectionRepository;
        this.stateService = stateService;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.scope = scope;
        this.authorizeUrl = authorizeUrl;
        this.tokenUrl = tokenUrl;
        this.callbackUrl = callbackUrl;
    }

    /** Build the GitHub authorize URL with a signed state bound to this user. */
    public String buildAuthorizeUrl(UUID userId) {
        String state = stateService.issue(userId);
        return UriComponentsBuilder.fromUriString(authorizeUrl)
                .queryParam("client_id", clientId)
                .queryParam("redirect_uri", callbackUrl)
                .queryParam("scope", scope)
                .queryParam("state", state)
                .build()
                .toUriString();
    }

    /**
     * Verify the state, exchange the code for an access token, fetch the login,
     * encrypt the token, and upsert the connection. Returns the saved connection.
     */
    @Transactional
    public GitHubConnection completeConnection(String code, String state) {
        UUID userId = stateService.verify(state);
        String accessToken = exchangeCodeForToken(code);
        String login = fetchLogin(accessToken);
        String encrypted = tokenCipher.encrypt(accessToken);

        GitHubConnection connection = connectionRepository.findByUserId(userId)
                .map(existing -> {
                    existing.setGithubLogin(login);
                    existing.setAccessTokenEnc(encrypted);
                    existing.setScope(scope);
                    return existing;
                })
                .orElseGet(() -> new GitHubConnection(userId, login, encrypted, scope));

        return connectionRepository.save(connection);
    }

    private String exchangeCodeForToken(String code) {
        Map<String, String> form = Map.of(
                "client_id", clientId,
                "client_secret", clientSecret,
                "code", code,
                "redirect_uri", callbackUrl);
        String response = restClient.post()
                .uri(tokenUrl)
                .header("Accept", "application/json")
                .contentType(MediaType.APPLICATION_JSON)
                .body(form)
                .retrieve()
                .body(String.class);
        JsonNode node = objectMapper.readTree(response);
        String token = node.path("access_token").asString("");
        if (token.isEmpty()) {
            throw new IllegalStateException("GitHub token exchange failed: "
                    + node.path("error").asString("unknown_error"));
        }
        return token;
    }

    private String fetchLogin(String accessToken) {
        String response = restClient.get()
                .uri("https://api.github.com/user")
                .header("Authorization", "Bearer " + accessToken)
                .header("User-Agent", "interviewiq-backend")
                .retrieve()
                .body(String.class);
        return objectMapper.readTree(response).path("login").asString("");
    }
}
