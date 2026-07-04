package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.UserResponse;
import com.interviewiq.interviewiq_backend.services.UserService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Current-user endpoint. The frontend calls this after authenticating to learn the
 * user's role (so it can show/hide admin-only surfaces like the intelligence console).
 */
@RestController
@RequestMapping(value = "/api/{version}/users", version = "1")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/me")
    public ResponseEntity<UserResponse> me(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        return userService.getById(userId)
                .map(user -> ResponseEntity.ok(new UserResponse(
                        user.getId().toString(), user.getEmail(), user.getName(), user.getRole().name(),
                        user.isOnboardingComplete())))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
