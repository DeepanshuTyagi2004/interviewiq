package com.interviewiq.interviewiq_backend.crypto;

import org.junit.jupiter.api.Test;

import javax.crypto.AEADBadTagException;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TokenCipherTest {

    // A deterministic 32-byte (256-bit) key, base64-encoded, for tests only.
    private static final String TEST_KEY_B64 =
            Base64.getEncoder().encodeToString(new byte[32]); // 32 zero bytes -> valid AES-256 key

    private final TokenCipher cipher = new TokenCipher(TEST_KEY_B64);

    @Test
    void roundTrip_returnsOriginalPlaintext() {
        String plaintext = "gho_exampleAccessToken1234567890";

        String encrypted = cipher.encrypt(plaintext);
        String decrypted = cipher.decrypt(encrypted);

        assertThat(decrypted).isEqualTo(plaintext);
    }

    @Test
    void encrypt_producesDifferentCiphertextEachTime_dueToRandomIv() {
        String plaintext = "same-secret";

        String first = cipher.encrypt(plaintext);
        String second = cipher.encrypt(plaintext);

        assertThat(first).isNotEqualTo(second);
        // both still decrypt back to the same plaintext
        assertThat(cipher.decrypt(first)).isEqualTo(plaintext);
        assertThat(cipher.decrypt(second)).isEqualTo(plaintext);
    }

    @Test
    void decrypt_tamperedCiphertext_throwsAuthenticationFailure() {
        String encrypted = cipher.encrypt("secret");
        byte[] raw = Base64.getDecoder().decode(encrypted);
        // flip the last byte of the GCM tag
        raw[raw.length - 1] ^= 0x01;
        String tampered = Base64.getEncoder().encodeToString(raw);

        assertThatThrownBy(() -> cipher.decrypt(tampered))
                .isInstanceOf(IllegalStateException.class)
                .hasCauseInstanceOf(AEADBadTagException.class);
    }
}
