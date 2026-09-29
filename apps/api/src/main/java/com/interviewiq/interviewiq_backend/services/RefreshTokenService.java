package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.RefreshResult;
import com.interviewiq.interviewiq_backend.models.RefreshToken;
import com.interviewiq.interviewiq_backend.models.User;
import com.interviewiq.interviewiq_backend.repositories.RefreshTokenRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;

@Service
public class RefreshTokenService {
    private final RefreshTokenRepository refreshTokenRepository;
    private final JwtService jwtService;
    private final long refreshTokenDays;
    private final SecureRandom secureRandom;

    public RefreshTokenService(
            RefreshTokenRepository refreshTokenRepository,
            JwtService jwtService,
            @Value("${app.refresh-token.days}") long refreshTokenDays) {
        this.refreshTokenRepository = refreshTokenRepository;
        this.jwtService = jwtService;
        this.refreshTokenDays = refreshTokenDays;
        this.secureRandom = new SecureRandom();
    }

    @Transactional
    public String createRefreshToken(User user) {
        String rawToken = generateToken();
        String tokenHash = hash(rawToken);

        RefreshToken refreshToken = new RefreshToken(
                tokenHash,
                user,
                Instant.now().plus(this.refreshTokenDays, ChronoUnit.DAYS)
        );

        refreshTokenRepository.save(refreshToken);
        return rawToken;
    }

    @Transactional
    public RefreshResult refresh(String rawToken) {
        RefreshToken existingRefreshToken = refreshTokenRepository
                .findByTokenHash(hash(rawToken))
                .orElseThrow(() -> new IllegalArgumentException("Invalid refresh token"));

        if (!existingRefreshToken.isActive()) {
            throw new IllegalArgumentException("Refresh token expired or revoked");
        }

        existingRefreshToken.revoke();

        User user = existingRefreshToken.getUser();

        String newRefreshToken = createRefreshToken(user);
        String accessToken = jwtService.createAccessToken(user);

        return new RefreshResult(accessToken, newRefreshToken);
    }

    @Transactional
    public void revoke(String rawToken) {
        refreshTokenRepository.findByTokenHash(hash(rawToken)).ifPresent(RefreshToken::revoke);
    }

    private String generateToken() {
        byte[] bytes = new byte[64];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hashed);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not hash refresh token", ex);
        }
    }

}
