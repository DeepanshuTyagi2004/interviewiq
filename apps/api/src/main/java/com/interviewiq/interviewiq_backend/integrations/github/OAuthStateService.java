package com.interviewiq.interviewiq_backend.integrations.github;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

/**
 * Stateless CSRF state for the GitHub OAuth handshake.
 * Format (base64url, no padding): "{userId}:{epochSeconds}:{hmac}".
 * The HMAC binds the userId + timestamp so a tampered/forged state is rejected.
 */
@Service
public class OAuthStateService {

    private static final Duration MAX_AGE = Duration.ofMinutes(10);

    private final SecretKeySpec key;

    public OAuthStateService(@Value("${app.jwt.secret}") String secret) {
        this.key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    public String issue(UUID userId) {
        long now = Instant.now().getEpochSecond();
        String payload = userId + ":" + now;
        String sig = sign(payload);
        return base64Url(payload + ":" + sig);
    }

    /** Returns the userId if the state is valid + unexpired; throws otherwise. */
    public UUID verify(String state) {
        String decoded = new String(Base64.getUrlDecoder().decode(state), StandardCharsets.UTF_8);
        String[] parts = decoded.split(":");
        if (parts.length != 3) {
            throw new IllegalArgumentException("Malformed OAuth state");
        }
        String payload = parts[0] + ":" + parts[1];
        String expectedSig = sign(payload);
        if (!constantTimeEquals(expectedSig, parts[2])) {
            throw new IllegalArgumentException("OAuth state signature mismatch");
        }
        long issuedAt = Long.parseLong(parts[1]);
        if (Instant.now().getEpochSecond() - issuedAt > MAX_AGE.toSeconds()) {
            throw new IllegalArgumentException("OAuth state expired");
        }
        return UUID.fromString(parts[0]);
    }

    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(key);
            byte[] raw = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        } catch (Exception ex) {
            throw new IllegalStateException("Could not sign OAuth state", ex);
        }
    }

    private String base64Url(String value) {
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private boolean constantTimeEquals(String a, String b) {
        byte[] ab = a.getBytes(StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(StandardCharsets.UTF_8);
        if (ab.length != bb.length) {
            return false;
        }
        int result = 0;
        for (int i = 0; i < ab.length; i++) {
            result |= ab[i] ^ bb[i];
        }
        return result == 0;
    }
}
