package com.interviewiq.interviewiq_backend.config;

import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.services.RefreshTokenService;
import com.interviewiq.interviewiq_backend.services.UserService;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;

@Component
public class OAuth2SuccessHandler implements AuthenticationSuccessHandler {
    private final UserService userService;
    private final RefreshTokenService refreshTokenService;
    private final String frontendUrl;
    private final long refreshTokenDays;

    public OAuth2SuccessHandler(
            UserService userService,
            RefreshTokenService refreshTokenService,
            @Value("${app.frontend-url}") String frontendUrl,
            @Value("${app.refresh-token.days}") long refreshTokenDays
    ) {
        this.userService = userService;
        this.refreshTokenService = refreshTokenService;
        this.frontendUrl = frontendUrl;
        this.refreshTokenDays = refreshTokenDays;
    }

    @Override
    public void onAuthenticationSuccess(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication) throws IOException, ServletException {
        Object principal = authentication.getPrincipal();

        if (!(principal instanceof OAuth2User oAuth2User)) {
            throw new IllegalStateException("OAuth2 login succeeded without OAuth2User principal");
        }

        User user = userService.upsertUser(oAuth2User);

        String refreshToken = refreshTokenService.createRefreshToken(user);

        ResponseCookie cookie = ResponseCookie.from("refresh_token", refreshToken)
                .httpOnly(true)
                .secure(false) // make true
                .sameSite("Lax")
                .path("/api/v1/auth")
                .maxAge(Duration.ofDays(refreshTokenDays))
                .build();

        response.addHeader("Set-Cookie", cookie.toString());
        response.sendRedirect(frontendUrl + "/auth/callback");
    }
}
