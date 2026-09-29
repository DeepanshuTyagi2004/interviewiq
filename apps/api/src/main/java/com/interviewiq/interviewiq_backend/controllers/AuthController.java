package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.RefreshResult;
import com.interviewiq.interviewiq_backend.dtos.TokenResponse;
import com.interviewiq.interviewiq_backend.services.RefreshTokenService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

@RestController
@RequestMapping(value = "/api/{version}/auth", version = "1")
public class AuthController {
    private final RefreshTokenService refreshTokenService;
    private final long refreshTokenDays;
    private final long accessTokenMinutes;

    public AuthController(
            RefreshTokenService refreshTokenService,
            @Value("${app.refresh-token.days}") long refreshTokenDays,
            @Value("${app.jwt.access-token-minutes}") long accessTokenMinutes
    ) {
        this.refreshTokenService = refreshTokenService;
        this.refreshTokenDays = refreshTokenDays;
        this.accessTokenMinutes = accessTokenMinutes;
    }

    @PostMapping("/refresh")
    public ResponseEntity<TokenResponse> refresh(
            @CookieValue(name = "refresh_token", required = false) String refreshToken,
            HttpServletResponse response
    ) {
        try {
            if (refreshToken == null) {
                clearRefreshTokenCookie(response);
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
            }

            RefreshResult refreshResult = refreshTokenService.refresh(refreshToken);

            String newRefreshToken = refreshResult.newRefreshToken();
            String accessToken = refreshResult.accessToken();

            ResponseCookie cookie = ResponseCookie.from("refresh_token", newRefreshToken)
                    .httpOnly(true)
                    .secure(false) // make true
                    .sameSite("Lax")
                    .path("/api/v1/auth")
                    .maxAge(Duration.ofDays(refreshTokenDays))
                    .build();

            response.addHeader("Set-Cookie", cookie.toString());

            return ResponseEntity
                    .ok(TokenResponse.bearer(
                            accessToken,
                            Duration.ofMinutes(accessTokenMinutes).toSeconds())
                    );
        } catch (IllegalArgumentException ex) {
            clearRefreshTokenCookie(response);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            @CookieValue(name = "refresh_token", required = false) String refreshToken,
            HttpServletResponse response
    ) {
        if (refreshToken != null) {
            refreshTokenService.revoke(refreshToken);
        }

        clearRefreshTokenCookie(response);

        return ResponseEntity.noContent().build();
    }

    private void clearRefreshTokenCookie(HttpServletResponse response) {
        ResponseCookie clearedCookie = ResponseCookie.from("refresh_token", "")
                .httpOnly(true)
                .secure(false)
                .sameSite("Lax")
                .path("/api/v1/auth")
                .maxAge(0)
                .build();

        response.addHeader("Set-Cookie", clearedCookie.toString());
    }
}
