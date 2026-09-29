package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.integrations.github.GitHubOAuthService;
import com.interviewiq.interviewiq_backend.models.GitHubConnection;
import com.interviewiq.interviewiq_backend.services.ProfileService;
import com.interviewiq.interviewiq_backend.dtos.AuthorizeUrlResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.UUID;

@RestController
@RequestMapping(value = "/api/{version}/connections/github", version = "1")
public class GitHubConnectionController {

    private static final Logger log = LoggerFactory.getLogger(GitHubConnectionController.class);

    private final GitHubOAuthService gitHubOAuthService;
    private final ProfileService profileService;
    private final String connectionsRedirect;

    public GitHubConnectionController(
            GitHubOAuthService gitHubOAuthService,
            ProfileService profileService,
            @Value("${app.connections-redirect}") String connectionsRedirect) {
        this.gitHubOAuthService = gitHubOAuthService;
        this.profileService = profileService;
        this.connectionsRedirect = connectionsRedirect;
    }

    /**
     * Returns the GitHub authorize URL as JSON. Requires a valid Bearer JWT.
     *
     * The frontend calls this via apiFetch (which sends the in-memory access token
     * as a Bearer header), then navigates the browser to the returned URL. We do NOT
     * 302 directly, because a top-level browser navigation to this endpoint cannot
     * carry the in-memory Bearer token (the user would be unauthenticated here).
     */
    @GetMapping("/authorize")
    public ResponseEntity<AuthorizeUrlResponse> authorize(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        UUID userId = UUID.fromString(jwt.getSubject());
        String url = gitHubOAuthService.buildAuthorizeUrl(userId);
        return ResponseEntity.ok(new AuthorizeUrlResponse(url));
    }

    /**
     * GitHub redirects here with code+state. We exchange, store, fetch synchronously,
     * then 302 the browser back to the frontend connections page. No JWT here (the
     * browser arrives via GitHub redirect); the signed state binds the user.
     */
    @GetMapping("/callback")
    public RedirectView callback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error) {
        if (error != null || code == null || state == null) {
            String url = UriComponentsBuilder.fromUriString(connectionsRedirect)
                    .queryParam("error", error != null ? error : "github_oauth_failed")
                    .build().toUriString();
            return new RedirectView(url);
        }
        try {
            GitHubConnection connection = gitHubOAuthService.completeConnection(code, state);
            profileService.refreshGitHub(connection); // synchronous fetch on connect
            return new RedirectView(connectionsRedirect);
        } catch (RuntimeException ex) {
            log.warn("GitHub connect callback failed", ex);
            String url = UriComponentsBuilder.fromUriString(connectionsRedirect)
                    .queryParam("error", "github_connect_failed")
                    .build().toUriString();
            return new RedirectView(url);
        }
    }

    /** Disconnect: delete the connection + GitHub fragment. Requires a Bearer JWT. */
    @DeleteMapping
    public ResponseEntity<Void> disconnect(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        profileService.disconnectGitHub(userId);
        return ResponseEntity.noContent().build();
    }
}
