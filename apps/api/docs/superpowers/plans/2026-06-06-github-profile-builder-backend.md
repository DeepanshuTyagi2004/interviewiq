# GitHub Profile Builder — Backend Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in student connect their GitHub account via a dedicated OAuth2 authorization-code flow, synchronously fetch + normalize their public GitHub data into an encrypted-token-backed `ProfileFragment`, and expose a descriptive (never scored) consolidated `GET /api/v1/profile/me` profile, with a weekly background refresh.

**Architecture:** A new self-contained `com.interviewiq.interviewiq_backend.profile` package. Two JPA entities (`GitHubConnection`, `ProfileFragment`) persist to the existing Supabase Postgres. `TokenCipher` (AES-256-GCM) encrypts the GitHub access token at rest. `GitHubOAuthService` runs a second OAuth flow (separate from the existing Google `oauth2Login`) using `RestClient`. `GitHubCollector` issues one GraphQL POST, maps to a normalized fragment, hashes it (SHA-256 over canonical JSON), and upserts only on change. `ProfileAssembler` (interface + rule-based impl) derives descriptive bands as a swappable stand-in for the future synthesis service. Controllers wire authorize/callback/disconnect/read endpoints; a `@Scheduled` job refreshes weekly.

**Tech Stack:** Spring Boot 4.0.6, Spring Framework 7.0.7, Java 25, Hibernate ORM 7.2.12, PostgreSQL (Supabase), Jackson 3.1.2 (`tools.jackson.databind`), Lombok, JUnit 6 + Mockito 5 + AssertJ + spring-security-test. **No new pom dependency is added** (RestClient ships in `spring-web`; Jackson + JPA + security are already present). The `@WebMvcTest` and unit tests need no DB.

---

## CRITICAL environment facts (verified against the live repo — do not assume otherwise)

- **This is Spring Boot 4 / Java 25, NOT 3.2/21.** Match the real versions.
- **Jackson is version 3.** The auto-configured mapper is `tools.jackson.databind.ObjectMapper` (NOT `com.fasterxml.jackson.databind.ObjectMapper`). `JsonNode` is `tools.jackson.databind.JsonNode`. **Annotations stay in `com.fasterxml.jackson.annotation`** (e.g. `@JsonInclude`, `@JsonProperty`).
- **`tools.jackson.core.JacksonException extends RuntimeException`** — `writeValueAsString`, `readValue`, `readTree`, `treeToValue` throw an **unchecked** exception. Do NOT wrap them in try/catch for checked-exception reasons (there is no checked `JsonProcessingException` in Jackson 3).
- **JSONB storage approach:** store the fragment as a `String` column annotated `columnDefinition = "jsonb"`, and serialize/deserialize with the injected `ObjectMapper`. We do NOT map a raw `JsonNode` through Hibernate `@JdbcTypeCode(SqlTypes.JSON)` because Hibernate 7's JSON support targets Jackson 2; keeping JSON as a `String` we control sidesteps the Jackson-version mismatch and gives us deterministic bytes for hashing.
- **Schema is auto-managed:** `spring.jpa.hibernate.ddl-auto=update` — new entities create their tables automatically. No Flyway in this repo.
- **API versioning convention:** controllers use `@RequestMapping(value = "/api/{version}/...", version = "1")` (driven by `spring.mvc.apiversion.use.path-segment=1`). Match this exactly; the resolved path is `/api/v1/...`.
- **Current user:** the JWT subject is the user UUID (`JwtService` sets `.subject(user.getId().toString())`). Extract it with `UUID.fromString(jwt.getSubject())` via `@AuthenticationPrincipal Jwt jwt`.
- **Constructor injection only** (no `@Autowired` fields), `@Value` for config, `record` DTOs, Lombok `@Getter/@Setter/@NoArgsConstructor` on entities. Match the existing style.
- **Maven wrapper:** `./mvnw` (run from repo root). Tests run offline-capable; use `./mvnw -o ...` to force offline if the network is flaky.
- **Existing `@SpringBootTest contextLoads()` needs the real `.env` (Supabase) reachable.** Our new unit tests and `@WebMvcTest` deliberately avoid the DB so they run anywhere.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/main/java/.../profile/model/ProfileSource.java` | Enum of profile sources: `GITHUB, RESUME, LEETCODE, LINKEDIN, X`. |
| `src/main/java/.../profile/model/GitHubConnection.java` | JPA entity: one GitHub connection per user (encrypted token, login, scope, timestamps). |
| `src/main/java/.../profile/model/ProfileFragment.java` | JPA entity: per-(user,source) normalized data as JSONB string + content hash + version + fetchedAt. |
| `src/main/java/.../profile/repository/GitHubConnectionRepository.java` | Spring Data repo: find/delete connection by userId. |
| `src/main/java/.../profile/repository/ProfileFragmentRepository.java` | Spring Data repo: find/delete fragments by userId and (userId, source). |
| `src/main/java/.../profile/crypto/TokenCipher.java` | AES-256-GCM encrypt/decrypt; key from `GITHUB_TOKEN_KEY`; random 12-byte IV prepended; base64 output. |
| `src/main/java/.../profile/github/GitHubOAuthService.java` | Builds GitHub authorize URL (signed state for CSRF), exchanges code→token via RestClient, encrypts + upserts `GitHubConnection`. |
| `src/main/java/.../profile/github/OAuthStateService.java` | Issues + validates short-lived HMAC-signed `state` tokens (CSRF for the GitHub handshake). |
| `src/main/java/.../profile/github/GitHubGraphQlResponse.java` | Internal record types mirroring the GraphQL JSON, used only for mapping. |
| `src/main/java/.../profile/github/GitHubCollector.java` | One GraphQL POST via RestClient → normalized fragment map → SHA-256 contentHash → upsert fragment iff hash changed. |
| `src/main/java/.../profile/assembler/ProfileAssembler.java` | Interface: fragments → descriptive bands (notable / mostUsedSkills / atAGlance). No scoring. |
| `src/main/java/.../profile/assembler/RuleBasedProfileAssembler.java` | Rule-based impl (synthesis stand-in). |
| `src/main/java/.../profile/service/ProfileService.java` | Orchestrates: read fragments + connections → build `ProfileResponse`; disconnect; refresh-all-for-user. |
| `src/main/java/.../profile/service/ProfileRefreshScheduler.java` | `@Scheduled` weekly refresh across all GitHub connections. |
| `src/main/java/.../profile/web/ProfileController.java` | `GET /api/v1/profile/me`. |
| `src/main/java/.../profile/web/GitHubConnectionController.java` | `GET .../connections/github/authorize`, `GET .../callback`, `DELETE .../connections/github`. |
| `src/main/java/.../profile/web/dto/ProfileResponse.java` | Top-level read DTO (exact §6 field names). |
| `src/main/java/.../profile/web/dto/ProfileUser.java` | `{ name, headline }`. |
| `src/main/java/.../profile/web/dto/SourceStatus.java` | `{ source, connected, lastRefreshedAt }`. |
| `src/main/java/.../profile/web/dto/NotableItem.java` | `{ text, source }`. |
| `src/main/java/.../profile/web/dto/SkillItem.java` | `{ skill, evidence }`. |
| `src/main/java/.../profile/web/dto/ProvenanceItem.java` | `{ source, fragmentHash, fetchedAt }`. |
| `src/main/java/.../config/SecurityConfig.java` | **Modify**: permit `/api/v1/connections/github/callback`, require JWT on other connection endpoints, keep existing rules. |
| `src/main/java/.../InterviewiqBackendApplication.java` | **Modify**: add `@EnableScheduling`. |
| `src/main/resources/application.properties` | **Modify**: add GitHub OAuth, token-key, redirect, and `RestClient` base-url properties. |
| `.env` | **Modify**: add the four new env vars (local dev only; gitignored). |
| `src/test/java/.../profile/crypto/TokenCipherTest.java` | Round-trip + tamper-detection. |
| `src/test/java/.../profile/github/GitHubCollectorTest.java` | Fixture mapping + hash stability. |
| `src/test/resources/fixtures/github-graphql-response.json` | Recorded GraphQL response fixture. |
| `src/test/java/.../profile/assembler/RuleBasedProfileAssemblerTest.java` | Asserts bands + **no scoring fields**. |
| `src/test/java/.../profile/web/ProfileControllerTest.java` | `@WebMvcTest` `GET /me` shape + unconnected sources. |

> Package root abbreviated as `.../` = `src/main/java/com/interviewiq/interviewiq_backend/`. Test root `.../` = `src/test/java/com/interviewiq/interviewiq_backend/`.

---

## Task 0: Branch, env, scheduling, properties

**Files:**
- Modify: `.env`
- Modify: `src/main/resources/application.properties`
- Modify: `src/main/java/com/interviewiq/interviewiq_backend/InterviewiqBackendApplication.java`

- [ ] **Step 0.1: Create the feature branch.**
  We are on `master`; branch first per repo rules.
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git checkout -b feat/github-profile-builder-backend
  ```
  Expected output:
  ```
  Switched to a new branch 'feat/github-profile-builder-backend'
  ```

- [ ] **Step 0.2: Generate a real 32-byte base64 AES key for local dev.**
  ```bash
  openssl rand -base64 32
  ```
  Expected output: a 44-char base64 string ending in `=`, e.g.
  ```
  k3J9...redacted...c0=
  ```
  Copy this value; it is used in Step 0.3 as `GITHUB_TOKEN_KEY`.

- [ ] **Step 0.3: Append the four new env vars to `.env`.**
  Open `/Users/salescode/Desktop/project/interviewiq-backend/.env` and append exactly (use the key from Step 0.2; the OAuth client values come from a GitHub OAuth App you register in Step 0.6):
  ```properties

  # --- GitHub OAuth App (Profile Builder) ---
  # Register at github.com/settings/developers -> New OAuth App
  # Authorization callback URL MUST be:
  #   http://localhost:8080/api/v1/connections/github/callback
  GITHUB_OAUTH_CLIENT_ID=replace-with-real-client-id
  GITHUB_OAUTH_CLIENT_SECRET=replace-with-real-client-secret

  # --- GitHub token encryption (AES-256-GCM, base64 32-byte key) ---
  # Generate with: openssl rand -base64 32
  GITHUB_TOKEN_KEY=replace-with-output-of-openssl-rand-base64-32

  # --- Where the OAuth callback redirects the browser back to ---
  FRONTEND_CONNECTIONS_REDIRECT=http://localhost:3000/connections
  ```

- [ ] **Step 0.4: Add the profile/GitHub properties to `application.properties`.**
  Open `/Users/salescode/Desktop/project/interviewiq-backend/src/main/resources/application.properties` and append at the end:
  ```properties

  # --- GitHub Profile Builder ---
  github.oauth.client-id=${GITHUB_OAUTH_CLIENT_ID}
  github.oauth.client-secret=${GITHUB_OAUTH_CLIENT_SECRET}
  github.oauth.scope=read:user
  github.oauth.authorize-url=https://github.com/login/oauth/authorize
  github.oauth.token-url=https://github.com/login/oauth/access_token
  github.oauth.callback-url=http://localhost:8080/api/v1/connections/github/callback
  github.api.graphql-url=https://api.github.com/graphql
  github.token-key=${GITHUB_TOKEN_KEY}
  app.connections-redirect=${FRONTEND_CONNECTIONS_REDIRECT:${app.frontend-url}/connections}
  ```
  Note: `app.connections-redirect` defaults to `{frontend}/connections` when `FRONTEND_CONNECTIONS_REDIRECT` is unset, exactly per spec §3.

- [ ] **Step 0.5: Enable scheduling on the application class.**
  Edit `src/main/java/com/interviewiq/interviewiq_backend/InterviewiqBackendApplication.java` to add the `@EnableScheduling` annotation and its import. Full file after edit:
  ```java
  package com.interviewiq.interviewiq_backend;

  import org.springframework.boot.SpringApplication;
  import org.springframework.boot.autoconfigure.SpringBootApplication;
  import org.springframework.scheduling.annotation.EnableScheduling;

  @SpringBootApplication
  @EnableScheduling
  public class InterviewiqBackendApplication {

  	public static void main(String[] args) {
  		SpringApplication.run(InterviewiqBackendApplication.class, args);
  	}

  }
  ```

- [ ] **Step 0.6: (Manual, one-time) Register the GitHub OAuth App.**
  Go to `https://github.com/settings/developers` → **New OAuth App**. Set Homepage `http://localhost:3000`, Authorization callback URL `http://localhost:8080/api/v1/connections/github/callback`. Paste the generated Client ID and a new Client secret into `.env` (Step 0.3). This is a security-relevant manual step; no code depends on it for compilation/tests.

- [ ] **Step 0.7: Confirm the project still compiles.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -DskipTests compile
  ```
  Expected: no error output; exit code 0.

- [ ] **Step 0.8: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/resources/application.properties src/main/java/com/interviewiq/interviewiq_backend/InterviewiqBackendApplication.java
  git commit -m "chore(profile): add GitHub OAuth config, scheduling, redirect props

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```
  Note: `.env` is gitignored and will not be staged — that is intentional.

---

## Task 1: TokenCipher (AES-256-GCM) — TDD

**Files:**
- Create: `src/main/java/.../profile/crypto/TokenCipher.java`
- Test: `src/test/java/.../profile/crypto/TokenCipherTest.java`

- [ ] **Step 1.1: Write the failing test.**
  Create `src/test/java/com/interviewiq/interviewiq_backend/profile/crypto/TokenCipherTest.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.crypto;

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
  ```

- [ ] **Step 1.2: Run the test — expect FAIL (does not compile: `TokenCipher` missing).**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest=TokenCipherTest test
  ```
  Expected: a compilation failure mentioning `cannot find symbol ... class TokenCipher` and `BUILD FAILURE`.

- [ ] **Step 1.3: Implement `TokenCipher`.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/crypto/TokenCipher.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.crypto;

  import org.springframework.beans.factory.annotation.Value;
  import org.springframework.stereotype.Component;

  import javax.crypto.Cipher;
  import javax.crypto.spec.GCMParameterSpec;
  import javax.crypto.spec.SecretKeySpec;
  import java.nio.charset.StandardCharsets;
  import java.security.SecureRandom;
  import java.util.Arrays;
  import java.util.Base64;

  /**
   * AES-256-GCM encryption for the GitHub access token at rest.
   *
   * Format of the base64 output: [12-byte random IV][ciphertext + 16-byte GCM tag].
   * The IV is prepended (not secret) and a fresh one is generated per encryption.
   */
  @Component
  public class TokenCipher {

      private static final String TRANSFORMATION = "AES/GCM/NoPadding";
      private static final int IV_LENGTH_BYTES = 12;
      private static final int GCM_TAG_LENGTH_BITS = 128;

      private final SecretKeySpec key;
      private final SecureRandom secureRandom = new SecureRandom();

      public TokenCipher(@Value("${github.token-key}") String base64Key) {
          byte[] keyBytes = Base64.getDecoder().decode(base64Key);
          if (keyBytes.length != 32) {
              throw new IllegalStateException(
                      "GITHUB_TOKEN_KEY must decode to 32 bytes (AES-256); got " + keyBytes.length);
          }
          this.key = new SecretKeySpec(keyBytes, "AES");
      }

      public String encrypt(String plaintext) {
          try {
              byte[] iv = new byte[IV_LENGTH_BYTES];
              secureRandom.nextBytes(iv);

              Cipher cipher = Cipher.getInstance(TRANSFORMATION);
              cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
              byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

              byte[] combined = new byte[iv.length + ciphertext.length];
              System.arraycopy(iv, 0, combined, 0, iv.length);
              System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

              return Base64.getEncoder().encodeToString(combined);
          } catch (Exception ex) {
              throw new IllegalStateException("Failed to encrypt token", ex);
          }
      }

      public String decrypt(String encrypted) {
          try {
              byte[] combined = Base64.getDecoder().decode(encrypted);
              byte[] iv = Arrays.copyOfRange(combined, 0, IV_LENGTH_BYTES);
              byte[] ciphertext = Arrays.copyOfRange(combined, IV_LENGTH_BYTES, combined.length);

              Cipher cipher = Cipher.getInstance(TRANSFORMATION);
              cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
              byte[] plaintext = cipher.doFinal(ciphertext);

              return new String(plaintext, StandardCharsets.UTF_8);
          } catch (Exception ex) {
              throw new IllegalStateException("Failed to decrypt token", ex);
          }
      }
  }
  ```
  Note: GCM authentication failure surfaces as `AEADBadTagException` (a `GeneralSecurityException`), which we wrap as `IllegalStateException` with the cause preserved — the tamper test asserts exactly this.

- [ ] **Step 1.4: Run the test — expect PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest=TokenCipherTest test
  ```
  Expected: `Tests run: 3, Failures: 0, Errors: 0, Skipped: 0` and `BUILD SUCCESS`.

- [ ] **Step 1.5: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/crypto/TokenCipher.java src/test/java/com/interviewiq/interviewiq_backend/profile/crypto/TokenCipherTest.java
  git commit -m "feat(profile): AES-256-GCM TokenCipher for GitHub token at rest

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 2: Profile entities + repositories

**Files:**
- Create: `src/main/java/.../profile/model/ProfileSource.java`
- Create: `src/main/java/.../profile/model/GitHubConnection.java`
- Create: `src/main/java/.../profile/model/ProfileFragment.java`
- Create: `src/main/java/.../profile/repository/GitHubConnectionRepository.java`
- Create: `src/main/java/.../profile/repository/ProfileFragmentRepository.java`

- [ ] **Step 2.1: Create the source enum.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/model/ProfileSource.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.model;

  public enum ProfileSource {
      GITHUB,
      RESUME,
      LEETCODE,
      LINKEDIN,
      X
  }
  ```

- [ ] **Step 2.2: Create the `GitHubConnection` entity.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/model/GitHubConnection.java` (matches existing entity style: Lombok `@Getter/@Setter/@NoArgsConstructor`, UUID id, `@PrePersist`/`@PreUpdate`):
  ```java
  package com.interviewiq.interviewiq_backend.profile.model;

  import jakarta.persistence.*;
  import lombok.Getter;
  import lombok.NoArgsConstructor;
  import lombok.Setter;

  import java.time.Instant;
  import java.util.UUID;

  @Entity
  @Table(name = "github_connection")
  @Getter
  @Setter
  @NoArgsConstructor
  public class GitHubConnection {

      @Id
      @GeneratedValue(strategy = GenerationType.UUID)
      @Column(updatable = false, nullable = false)
      private UUID id;

      @Column(name = "user_id", unique = true, nullable = false)
      private UUID userId;

      @Column(name = "github_login", nullable = false)
      private String githubLogin;

      // AES-256-GCM ciphertext (base64). NEVER logged, NEVER exposed in a DTO.
      @Column(name = "access_token_enc", nullable = false, length = 2048)
      private String accessTokenEnc;

      @Column(nullable = false)
      private String scope;

      @Column(name = "connected_at", nullable = false, updatable = false)
      private Instant connectedAt;

      @Column(name = "last_refreshed_at")
      private Instant lastRefreshedAt;

      public GitHubConnection(UUID userId, String githubLogin, String accessTokenEnc, String scope) {
          this.userId = userId;
          this.githubLogin = githubLogin;
          this.accessTokenEnc = accessTokenEnc;
          this.scope = scope;
      }

      @PrePersist
      void onCreate() {
          this.connectedAt = Instant.now();
      }
  }
  ```

- [ ] **Step 2.3: Create the `ProfileFragment` entity.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/model/ProfileFragment.java`. The `data` field is the canonical JSON string stored as `jsonb`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.model;

  import jakarta.persistence.*;
  import lombok.Getter;
  import lombok.NoArgsConstructor;
  import lombok.Setter;

  import java.time.Instant;
  import java.util.UUID;

  @Entity
  @Table(
          name = "profile_fragment",
          uniqueConstraints = @UniqueConstraint(
                  name = "uq_fragment_user_source",
                  columnNames = {"user_id", "source"}
          )
  )
  @Getter
  @Setter
  @NoArgsConstructor
  public class ProfileFragment {

      @Id
      @GeneratedValue(strategy = GenerationType.UUID)
      @Column(updatable = false, nullable = false)
      private UUID id;

      @Column(name = "user_id", nullable = false)
      private UUID userId;

      @Enumerated(EnumType.STRING)
      @Column(nullable = false, length = 32)
      private ProfileSource source;

      // Canonical (key-sorted) JSON. Stored as Postgres jsonb; (de)serialized via ObjectMapper.
      @Column(name = "data", nullable = false, columnDefinition = "jsonb")
      private String data;

      @Column(name = "content_hash", nullable = false, length = 64)
      private String contentHash;

      @Column(nullable = false)
      private int version;

      @Column(name = "fetched_at", nullable = false)
      private Instant fetchedAt;

      public ProfileFragment(UUID userId, ProfileSource source, String data, String contentHash) {
          this.userId = userId;
          this.source = source;
          this.data = data;
          this.contentHash = contentHash;
          this.version = 1;
          this.fetchedAt = Instant.now();
      }
  }
  ```

- [ ] **Step 2.4: Create the connection repository.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/repository/GitHubConnectionRepository.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.repository;

  import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
  import org.springframework.data.jpa.repository.JpaRepository;
  import org.springframework.stereotype.Repository;

  import java.util.Optional;
  import java.util.UUID;

  @Repository
  public interface GitHubConnectionRepository extends JpaRepository<GitHubConnection, UUID> {
      Optional<GitHubConnection> findByUserId(UUID userId);

      void deleteByUserId(UUID userId);
  }
  ```

- [ ] **Step 2.5: Create the fragment repository.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/repository/ProfileFragmentRepository.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.repository;

  import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
  import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
  import org.springframework.data.jpa.repository.JpaRepository;
  import org.springframework.stereotype.Repository;

  import java.util.List;
  import java.util.Optional;
  import java.util.UUID;

  @Repository
  public interface ProfileFragmentRepository extends JpaRepository<ProfileFragment, UUID> {
      List<ProfileFragment> findByUserId(UUID userId);

      Optional<ProfileFragment> findByUserIdAndSource(UUID userId, ProfileSource source);

      void deleteByUserIdAndSource(UUID userId, ProfileSource source);
  }
  ```

- [ ] **Step 2.6: Compile to verify the entities and repos are valid.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -DskipTests compile
  ```
  Expected: no output, exit code 0.

- [ ] **Step 2.7: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/model src/main/java/com/interviewiq/interviewiq_backend/profile/repository
  git commit -m "feat(profile): GitHubConnection + ProfileFragment entities and repositories

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3: GitHubCollector — normalized mapping + content hash (TDD)

This is the core data path. We test it with a recorded fixture and no network: the test injects a fake `RestClient` is overkill, so we structure `GitHubCollector` so the GraphQL→fragment **mapping + hashing** is a pure method (`toFragmentJson(JsonNode root)` + `sha256(String)`), testable directly from a JSON fixture. The network call is a thin wrapper around `RestClient`.

**Files:**
- Create: `src/test/resources/fixtures/github-graphql-response.json`
- Create: `src/main/java/.../profile/github/GitHubCollector.java`
- Test: `src/test/java/.../profile/github/GitHubCollectorTest.java`

- [ ] **Step 3.1: Create the recorded GraphQL fixture.**
  Create `src/test/resources/fixtures/github-graphql-response.json`. This mirrors the shape returned by the GitHub GraphQL API for our query (see Step 3.5 for the query):
  ```json
  {
    "data": {
      "viewer": {
        "login": "aishav",
        "name": "Aisha Verma",
        "avatarUrl": "https://avatars.githubusercontent.com/u/123",
        "createdAt": "2021-08-14T10:00:00Z",
        "repositories": {
          "totalCount": 38,
          "nodes": [
            {
              "name": "campus-placement-bot",
              "stargazerCount": 42,
              "pushedAt": "2026-05-30T12:00:00Z",
              "isFork": false,
              "primaryLanguage": { "name": "TypeScript" },
              "languages": {
                "edges": [
                  { "size": 800000, "node": { "name": "TypeScript" } },
                  { "size": 200000, "node": { "name": "CSS" } }
                ]
              }
            },
            {
              "name": "ml-notes",
              "stargazerCount": 7,
              "pushedAt": "2026-04-01T12:00:00Z",
              "isFork": false,
              "primaryLanguage": { "name": "Python" },
              "languages": {
                "edges": [
                  { "size": 400000, "node": { "name": "Python" } }
                ]
              }
            },
            {
              "name": "forked-stuff",
              "stargazerCount": 0,
              "pushedAt": "2025-01-01T12:00:00Z",
              "isFork": true,
              "primaryLanguage": { "name": "Java" },
              "languages": {
                "edges": [
                  { "size": 999999, "node": { "name": "Java" } }
                ]
              }
            }
          ]
        },
        "contributionsCollection": {
          "contributionCalendar": {
            "totalContributions": 1204,
            "weeks": [
              { "contributionDays": [
                { "contributionCount": 0 }, { "contributionCount": 1 }, { "contributionCount": 3 },
                { "contributionCount": 0 }, { "contributionCount": 2 }, { "contributionCount": 5 },
                { "contributionCount": 1 }
              ] },
              { "contributionDays": [
                { "contributionCount": 2 }, { "contributionCount": 0 }, { "contributionCount": 0 },
                { "contributionCount": 4 }, { "contributionCount": 1 }, { "contributionCount": 0 },
                { "contributionCount": 3 }
              ] }
            ]
          },
          "pullRequestContributionsByRepository": [
            { "repository": { "owner": { "login": "vercel" } }, "contributions": { "totalCount": 9 } },
            { "repository": { "owner": { "login": "aishav" } }, "contributions": { "totalCount": 5 } },
            { "repository": { "owner": { "login": "facebook" } }, "contributions": { "totalCount": 8 } }
          ]
        }
      }
    }
  }
  ```
  Note: `forked-stuff` (isFork=true) and PRs to the user's own repos (`owner.login == login`) must be excluded by the mapper (skip-list per CLAUDE.md / spec §4). External PRs here = 9 + 8 = 17.

- [ ] **Step 3.2: Write the failing test.**
  Create `src/test/java/com/interviewiq/interviewiq_backend/profile/github/GitHubCollectorTest.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.github;

  import org.junit.jupiter.api.BeforeEach;
  import org.junit.jupiter.api.Test;
  import tools.jackson.databind.JsonNode;
  import tools.jackson.databind.ObjectMapper;

  import java.nio.charset.StandardCharsets;
  import java.nio.file.Files;
  import java.nio.file.Path;

  import static org.assertj.core.api.Assertions.assertThat;

  class GitHubCollectorTest {

      private final ObjectMapper objectMapper = new ObjectMapper();
      private GitHubCollector collector;
      private JsonNode fixtureRoot;

      @BeforeEach
      void setUp() throws Exception {
          // GitHubCollector's network deps are not exercised here; pass nulls for the
          // RestClient + token cipher + repo (mapping/hashing methods don't touch them).
          collector = new GitHubCollector(null, objectMapper, null, null,
                  "https://api.github.com/graphql");
          String json = Files.readString(
                  Path.of("src/test/resources/fixtures/github-graphql-response.json"),
                  StandardCharsets.UTF_8);
          fixtureRoot = objectMapper.readTree(json);
      }

      @Test
      void toFragmentJson_mapsCoreProfileFields() {
          String canonical = collector.toFragmentJson(fixtureRoot);
          JsonNode f = objectMapper.readTree(canonical);

          assertThat(f.get("login").asString()).isEqualTo("aishav");
          assertThat(f.get("name").asString()).isEqualTo("Aisha Verma");
          assertThat(f.get("joinedYear").asInt()).isEqualTo(2021);
          assertThat(f.get("publicRepos").asInt()).isEqualTo(38);
          assertThat(f.get("contributions").get("lastYear").asInt()).isEqualTo(1204);
      }

      @Test
      void toFragmentJson_excludesForksAndComputesExternalPRs() {
          String canonical = collector.toFragmentJson(fixtureRoot);
          JsonNode f = objectMapper.readTree(canonical);

          // forked-stuff must NOT appear in topRepos (skip-list: forks)
          assertThat(f.get("topRepos").toString()).doesNotContain("forked-stuff");
          // external PRs = PRs to repos NOT owned by the user = 9 (vercel) + 8 (facebook) = 17
          assertThat(f.get("externalPRs").asInt()).isEqualTo(17);
      }

      @Test
      void toFragmentJson_buildsLanguagePercentagesFromNonForkBytes() {
          String canonical = collector.toFragmentJson(fixtureRoot);
          JsonNode f = objectMapper.readTree(canonical);
          JsonNode languages = f.get("languages");

          // TS 800k + Python 400k + CSS 200k = 1.4M non-fork bytes
          // TS = 800000/1400000 = 57%, Python = 28%, CSS = 14%
          assertThat(languages.get(0).get("name").asString()).isEqualTo("TypeScript");
          assertThat(languages.get(0).get("pct").asInt()).isEqualTo(57);
      }

      @Test
      void contentHash_isStableForSameInput_andChangesWhenDataChanges() {
          String canonical1 = collector.toFragmentJson(fixtureRoot);
          String canonical2 = collector.toFragmentJson(fixtureRoot);
          assertThat(GitHubCollector.sha256(canonical1))
                  .isEqualTo(GitHubCollector.sha256(canonical2));

          // mutate one field -> different canonical JSON -> different hash
          JsonNode mutated = objectMapper.readTree(
                  canonical1.replace("\"lastYear\":1204", "\"lastYear\":1205"));
          String mutatedCanonical = collector.canonicalize(mutated);
          assertThat(GitHubCollector.sha256(mutatedCanonical))
                  .isNotEqualTo(GitHubCollector.sha256(canonical1));
      }

      @Test
      void canonicalize_isKeyOrderIndependent() {
          JsonNode a = objectMapper.readTree("{\"b\":1,\"a\":2}");
          JsonNode b = objectMapper.readTree("{\"a\":2,\"b\":1}");
          assertThat(collector.canonicalize(a)).isEqualTo(collector.canonicalize(b));
      }
  }
  ```

- [ ] **Step 3.3: Run the test — expect FAIL (does not compile: `GitHubCollector` missing).**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest=GitHubCollectorTest test
  ```
  Expected: compilation failure `cannot find symbol ... GitHubCollector`, `BUILD FAILURE`.

- [ ] **Step 3.4: Create the GraphQL response record types (mapping helpers, optional but keeps the collector tidy).**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/github/GitHubGraphQlResponse.java`. (We parse with `JsonNode` in the collector, so these records are not strictly required; we still create the file empty-of-logic to document the contract and keep the package coherent.)
  ```java
  package com.interviewiq.interviewiq_backend.profile.github;

  /**
   * Documentation of the GraphQL response shape we depend on. We deliberately
   * parse with JsonNode in GitHubCollector (resilient to extra/missing fields),
   * so this type carries no logic; it records the contract for future readers.
   *
   * data.viewer {
   *   login, name, avatarUrl, createdAt,
   *   repositories { totalCount, nodes[]{ name, stargazerCount, pushedAt, isFork,
   *       primaryLanguage{name}, languages{ edges[]{ size, node{name} } } } },
   *   contributionsCollection {
   *     contributionCalendar { totalContributions, weeks[]{ contributionDays[]{ contributionCount } } },
   *     pullRequestContributionsByRepository[]{ repository{ owner{login} }, contributions{ totalCount } }
   *   }
   * }
   */
  public final class GitHubGraphQlResponse {
      private GitHubGraphQlResponse() {
      }
  }
  ```

- [ ] **Step 3.5: Implement `GitHubCollector`.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/github/GitHubCollector.java`. Note the Jackson 3 imports (`tools.jackson.*`), the unchecked exceptions, the skip-list (forks, self-PRs), and the canonical key-sorted serialization for stable hashing:
  ```java
  package com.interviewiq.interviewiq_backend.profile.github;

  import com.interviewiq.interviewiq_backend.profile.crypto.TokenCipher;
  import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
  import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
  import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
  import com.interviewiq.interviewiq_backend.profile.repository.ProfileFragmentRepository;
  import org.springframework.beans.factory.annotation.Value;
  import org.springframework.http.MediaType;
  import org.springframework.stereotype.Service;
  import org.springframework.transaction.annotation.Transactional;
  import org.springframework.web.client.RestClient;
  import tools.jackson.databind.JsonNode;
  import tools.jackson.databind.ObjectMapper;
  import tools.jackson.databind.SerializationFeature;
  import tools.jackson.databind.node.ArrayNode;
  import tools.jackson.databind.node.ObjectNode;

  import java.nio.charset.StandardCharsets;
  import java.security.MessageDigest;
  import java.time.Instant;
  import java.util.ArrayList;
  import java.util.Comparator;
  import java.util.HexFormat;
  import java.util.LinkedHashMap;
  import java.util.List;
  import java.util.Map;
  import java.util.Optional;

  @Service
  public class GitHubCollector {

      private static final String GRAPHQL_QUERY = """
              query {
                viewer {
                  login
                  name
                  avatarUrl
                  createdAt
                  repositories(first: 100, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
                    totalCount
                    nodes {
                      name
                      stargazerCount
                      pushedAt
                      isFork
                      primaryLanguage { name }
                      languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                        edges { size node { name } }
                      }
                    }
                  }
                  contributionsCollection {
                    contributionCalendar {
                      totalContributions
                      weeks { contributionDays { contributionCount } }
                    }
                    pullRequestContributionsByRepository(maxRepositories: 100) {
                      repository { owner { login } }
                      contributions { totalCount }
                    }
                  }
                }
              }
              """;

      private final RestClient restClient;
      private final ObjectMapper objectMapper;
      private final TokenCipher tokenCipher;
      private final ProfileFragmentRepository fragmentRepository;
      private final String graphQlUrl;

      public GitHubCollector(
              RestClient restClient,
              ObjectMapper objectMapper,
              TokenCipher tokenCipher,
              ProfileFragmentRepository fragmentRepository,
              @Value("${github.api.graphql-url}") String graphQlUrl) {
          this.restClient = restClient;
          this.objectMapper = objectMapper;
          this.tokenCipher = tokenCipher;
          this.fragmentRepository = fragmentRepository;
          this.graphQlUrl = graphQlUrl;
      }

      /**
       * Fetch from GitHub for the given connection, map to the normalized fragment,
       * and upsert the ProfileFragment only if the content hash changed.
       */
      @Transactional
      public void collectAndStore(GitHubConnection connection) {
          String accessToken = tokenCipher.decrypt(connection.getAccessTokenEnc());
          JsonNode root = postGraphQl(accessToken);
          String canonicalData = toFragmentJson(root);
          String hash = sha256(canonicalData);

          Optional<ProfileFragment> existing =
                  fragmentRepository.findByUserIdAndSource(connection.getUserId(), ProfileSource.GITHUB);

          if (existing.isPresent()) {
              ProfileFragment fragment = existing.get();
              if (fragment.getContentHash().equals(hash)) {
                  // unchanged: just bump fetchedAt (idempotent — cost discipline)
                  fragment.setFetchedAt(Instant.now());
              } else {
                  fragment.setData(canonicalData);
                  fragment.setContentHash(hash);
                  fragment.setVersion(fragment.getVersion() + 1);
                  fragment.setFetchedAt(Instant.now());
              }
              fragmentRepository.save(fragment);
          } else {
              fragmentRepository.save(
                      new ProfileFragment(connection.getUserId(), ProfileSource.GITHUB, canonicalData, hash));
          }
      }

      private JsonNode postGraphQl(String accessToken) {
          Map<String, String> body = Map.of("query", GRAPHQL_QUERY);
          String response = restClient.post()
                  .uri(graphQlUrl)
                  .header("Authorization", "Bearer " + accessToken)
                  .header("User-Agent", "interviewiq-backend")
                  .contentType(MediaType.APPLICATION_JSON)
                  .body(body)
                  .retrieve()
                  .body(String.class);
          return objectMapper.readTree(response);
      }

      /**
       * Map the raw GraphQL JSON into the normalized fragment (spec §4) and return
       * it as canonical (key-sorted) JSON, ready for hashing + storage.
       */
      public String toFragmentJson(JsonNode root) {
          JsonNode viewer = root.path("data").path("viewer");

          Map<String, Object> fragment = new LinkedHashMap<>();
          fragment.put("login", viewer.path("login").asString(""));
          fragment.put("name", viewer.path("name").asString(""));
          fragment.put("avatarUrl", viewer.path("avatarUrl").asString(""));
          fragment.put("joinedYear", parseYear(viewer.path("createdAt").asString("")));
          fragment.put("publicRepos", viewer.path("repositories").path("totalCount").asInt(0));

          // contributions: lastYear total + 52x7 weeks grid
          JsonNode calendar = viewer.path("contributionsCollection").path("contributionCalendar");
          Map<String, Object> contributions = new LinkedHashMap<>();
          contributions.put("lastYear", calendar.path("totalContributions").asInt(0));
          List<List<Integer>> weeks = new ArrayList<>();
          for (JsonNode week : calendar.path("weeks")) {
              List<Integer> days = new ArrayList<>();
              for (JsonNode day : week.path("contributionDays")) {
                  days.add(day.path("contributionCount").asInt(0));
              }
              weeks.add(days);
          }
          contributions.put("weeks", weeks);
          fragment.put("contributions", contributions);

          // languages: aggregate bytes across NON-FORK repos, percentages, sorted desc
          Map<String, Long> bytesByLang = new LinkedHashMap<>();
          List<Map<String, Object>> topRepos = new ArrayList<>();
          for (JsonNode repo : viewer.path("repositories").path("nodes")) {
              if (repo.path("isFork").asBoolean(false)) {
                  continue; // skip-list: forks
              }
              for (JsonNode edge : repo.path("languages").path("edges")) {
                  String lang = edge.path("node").path("name").asString("");
                  long size = edge.path("size").asLong(0);
                  if (!lang.isEmpty()) {
                      bytesByLang.merge(lang, size, Long::sum);
                  }
              }
              Map<String, Object> r = new LinkedHashMap<>();
              r.put("name", repo.path("name").asString(""));
              r.put("stars", repo.path("stargazerCount").asInt(0));
              r.put("primaryLang", repo.path("primaryLanguage").path("name").asString(""));
              topRepos.add(r);
          }
          long totalBytes = bytesByLang.values().stream().mapToLong(Long::longValue).sum();
          List<Map<String, Object>> languages = new ArrayList<>();
          bytesByLang.entrySet().stream()
                  .sorted(Map.Entry.<String, Long>comparingByValue().reversed())
                  .forEach(e -> {
                      Map<String, Object> l = new LinkedHashMap<>();
                      l.put("name", e.getKey());
                      l.put("pct", totalBytes == 0 ? 0 : Math.round(e.getValue() * 100.0 / totalBytes));
                      l.put("bytes", e.getValue());
                      languages.add(l);
                  });
          fragment.put("languages", languages);

          // topRepos: by stars desc, keep top 10 (recent-push order preserved from query as tiebreak)
          topRepos.sort(Comparator.comparingInt(r -> -((Integer) r.get("stars"))));
          fragment.put("topRepos", topRepos.size() > 10 ? topRepos.subList(0, 10) : topRepos);

          // externalPRs: PRs to repos NOT owned by the viewer (skip self-owned)
          String login = viewer.path("login").asString("");
          int externalPRs = 0;
          for (JsonNode prRepo : viewer.path("contributionsCollection")
                  .path("pullRequestContributionsByRepository")) {
              String owner = prRepo.path("repository").path("owner").path("login").asString("");
              if (!owner.equals(login)) {
                  externalPRs += prRepo.path("contributions").path("totalCount").asInt(0);
              }
          }
          fragment.put("externalPRs", externalPRs);

          // serialize to canonical (key-sorted) JSON
          JsonNode tree = objectMapper.valueToTree(fragment);
          return canonicalize(tree);
      }

      /** Serialize a JsonNode with map keys sorted, producing deterministic bytes for hashing. */
      public String canonicalize(JsonNode node) {
          return objectMapper.writer()
                  .with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                  .writeValueAsString(sortNode(node));
      }

      /** Recursively rebuild the node so object keys are sorted (arrays keep order). */
      private JsonNode sortNode(JsonNode node) {
          if (node.isObject()) {
              ObjectNode sorted = objectMapper.createObjectNode();
              List<String> names = new ArrayList<>();
              node.propertyNames().forEach(names::add);
              names.sort(Comparator.naturalOrder());
              for (String name : names) {
                  sorted.set(name, sortNode(node.get(name)));
              }
              return sorted;
          }
          if (node.isArray()) {
              ArrayNode arr = objectMapper.createArrayNode();
              for (JsonNode child : node) {
                  arr.add(sortNode(child));
              }
              return arr;
          }
          return node;
      }

      public static String sha256(String input) {
          try {
              MessageDigest digest = MessageDigest.getInstance("SHA-256");
              byte[] hashed = digest.digest(input.getBytes(StandardCharsets.UTF_8));
              return HexFormat.of().formatHex(hashed);
          } catch (Exception ex) {
              throw new IllegalStateException("Could not hash fragment data", ex);
          }
      }

      private int parseYear(String iso) {
          if (iso == null || iso.length() < 4) {
              return 0;
          }
          return Integer.parseInt(iso.substring(0, 4));
      }
  }
  ```
  Note: `node.propertyNames()` returns field names in Jackson 3 (the Jackson-2 `fieldNames()` was renamed). `asString(...)` / `asInt(...)` / `asLong(...)` / `asBoolean(...)` with defaults are the Jackson 3 `JsonNode` accessors used here.

- [ ] **Step 3.6: Run the test — expect PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest=GitHubCollectorTest test
  ```
  Expected: `Tests run: 5, Failures: 0, Errors: 0, Skipped: 0`, `BUILD SUCCESS`.
  If `asString`/`propertyNames` do not resolve, generate the classpath first with `./mvnw -o dependency:build-classpath -Dmdep.outputFile=/tmp/cp.txt -q`, then run `javap -classpath "$(cat /tmp/cp.txt)" tools.jackson.databind.JsonNode | grep -iE "asString|propertyNames|asInt"` to confirm the exact Jackson 3 accessor names and adjust.

- [ ] **Step 3.7: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/github src/test/java/com/interviewiq/interviewiq_backend/profile/github src/test/resources/fixtures/github-graphql-response.json
  git commit -m "feat(profile): GitHubCollector GraphQL mapping + SHA-256 content hashing

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4: ProfileAssembler — rule-based, no scoring (TDD)

**Files:**
- Create: `src/main/java/.../profile/web/dto/NotableItem.java`
- Create: `src/main/java/.../profile/web/dto/SkillItem.java`
- Create: `src/main/java/.../profile/assembler/ProfileAssembler.java`
- Create: `src/main/java/.../profile/assembler/RuleBasedProfileAssembler.java`
- Test: `src/test/java/.../profile/assembler/RuleBasedProfileAssemblerTest.java`

- [ ] **Step 4.1: Create the band DTOs.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/NotableItem.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web.dto;

  public record NotableItem(String text, String source) {
  }
  ```
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/SkillItem.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web.dto;

  public record SkillItem(String skill, String evidence) {
  }
  ```

- [ ] **Step 4.2: Create the `ProfileAssembler` interface + result holder.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/assembler/ProfileAssembler.java`. The result is a `record` so the future synthesis service can implement the same interface:
  ```java
  package com.interviewiq.interviewiq_backend.profile.assembler;

  import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
  import com.interviewiq.interviewiq_backend.profile.web.dto.NotableItem;
  import com.interviewiq.interviewiq_backend.profile.web.dto.SkillItem;

  import java.util.List;

  /**
   * Produces descriptive (never scored/ranked) profile bands from fragments.
   * Isolated behind this interface so the real synthesis service can replace
   * the rule-based stand-in without touching controllers or DTOs.
   */
  public interface ProfileAssembler {

      Bands assemble(List<ProfileFragment> fragments);

      record Bands(
              List<NotableItem> notable,
              List<SkillItem> mostUsedSkills,
              List<String> atAGlance
      ) {
      }
  }
  ```

- [ ] **Step 4.3: Write the failing test.**
  Create `src/test/java/com/interviewiq/interviewiq_backend/profile/assembler/RuleBasedProfileAssemblerTest.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.assembler;

  import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
  import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
  import org.junit.jupiter.api.Test;
  import tools.jackson.databind.ObjectMapper;

  import java.util.List;
  import java.util.UUID;

  import static org.assertj.core.api.Assertions.assertThat;

  class RuleBasedProfileAssemblerTest {

      private final ObjectMapper objectMapper = new ObjectMapper();
      private final RuleBasedProfileAssembler assembler = new RuleBasedProfileAssembler(objectMapper);

      private ProfileFragment githubFragment() {
          String data = """
                  {
                    "login":"aishav","name":"Aisha Verma","avatarUrl":"x",
                    "joinedYear":2021,"publicRepos":38,
                    "contributions":{"lastYear":1204,"weeks":[]},
                    "languages":[
                      {"name":"TypeScript","pct":48,"bytes":1234567},
                      {"name":"Python","pct":30,"bytes":700000}
                    ],
                    "externalPRs":17,
                    "topRepos":[{"name":"campus-placement-bot","stars":42,"primaryLang":"TypeScript"}]
                  }
                  """;
          return new ProfileFragment(UUID.randomUUID(), ProfileSource.GITHUB, data, "hash");
      }

      @Test
      void assemble_buildsNotableFromContributionsAndPRs() {
          var bands = assembler.assemble(List.of(githubFragment()));

          assertThat(bands.notable())
                  .anySatisfy(n -> {
                      assertThat(n.text()).contains("1,204").contains("contributions");
                      assertThat(n.source()).isEqualTo("GITHUB");
                  });
          assertThat(bands.notable())
                  .anySatisfy(n -> assertThat(n.text()).contains("17").contains("pull request"));
      }

      @Test
      void assemble_skillsCarryEvidenceNamingTheSource() {
          var bands = assembler.assemble(List.of(githubFragment()));

          assertThat(bands.mostUsedSkills()).isNotEmpty();
          assertThat(bands.mostUsedSkills().get(0).skill()).isEqualTo("TypeScript");
          assertThat(bands.mostUsedSkills().get(0).evidence()).isEqualTo("GitHub 48%");
          // every skill must carry evidence (CLAUDE.md hard rule)
          assertThat(bands.mostUsedSkills())
                  .allSatisfy(s -> assertThat(s.evidence()).isNotBlank());
      }

      @Test
      void assemble_atAGlanceDescribesActivity() {
          var bands = assembler.assemble(List.of(githubFragment()));
          assertThat(bands.atAGlance()).isNotEmpty();
          assertThat(String.join(" ", bands.atAGlance())).contains("38 repos");
      }

      @Test
      void assemble_outputContainsNoScoringOrRankingFields() {
          var bands = assembler.assemble(List.of(githubFragment()));
          // Serialize the whole bands object and assert no forbidden comparative vocabulary.
          String json = objectMapper.writeValueAsString(bands).toLowerCase();
          assertThat(json)
                  .doesNotContain("\"score\"")
                  .doesNotContain("\"rating\"")
                  .doesNotContain("\"rank\"")
                  .doesNotContain("\"grade\"")
                  .doesNotContain("percentile")
                  .doesNotContain("above average")
                  .doesNotContain("better than");
      }

      @Test
      void assemble_withNoFragments_returnsEmptyBands() {
          var bands = assembler.assemble(List.of());
          assertThat(bands.notable()).isEmpty();
          assertThat(bands.mostUsedSkills()).isEmpty();
          assertThat(bands.atAGlance()).isEmpty();
      }
  }
  ```

- [ ] **Step 4.4: Run the test — expect FAIL (does not compile: `RuleBasedProfileAssembler` missing).**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest=RuleBasedProfileAssemblerTest test
  ```
  Expected: compilation failure `cannot find symbol ... RuleBasedProfileAssembler`, `BUILD FAILURE`.

- [ ] **Step 4.5: Implement `RuleBasedProfileAssembler`.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/assembler/RuleBasedProfileAssembler.java`. Descriptive only; no comparative language:
  ```java
  package com.interviewiq.interviewiq_backend.profile.assembler;

  import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
  import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
  import com.interviewiq.interviewiq_backend.profile.web.dto.NotableItem;
  import com.interviewiq.interviewiq_backend.profile.web.dto.SkillItem;
  import org.springframework.stereotype.Component;
  import tools.jackson.databind.JsonNode;
  import tools.jackson.databind.ObjectMapper;

  import java.text.NumberFormat;
  import java.util.ArrayList;
  import java.util.List;
  import java.util.Locale;
  import java.util.Optional;

  @Component
  public class RuleBasedProfileAssembler implements ProfileAssembler {

      private final ObjectMapper objectMapper;
      private final NumberFormat grouping = NumberFormat.getIntegerInstance(Locale.US);

      public RuleBasedProfileAssembler(ObjectMapper objectMapper) {
          this.objectMapper = objectMapper;
      }

      @Override
      public Bands assemble(List<ProfileFragment> fragments) {
          List<NotableItem> notable = new ArrayList<>();
          List<SkillItem> skills = new ArrayList<>();
          List<String> atAGlance = new ArrayList<>();

          Optional<JsonNode> github = fragments.stream()
                  .filter(f -> f.getSource() == ProfileSource.GITHUB)
                  .map(f -> objectMapper.readTree(f.getData()))
                  .findFirst();

          github.ifPresent(g -> {
              int lastYear = g.path("contributions").path("lastYear").asInt(0);
              if (lastYear > 0) {
                  notable.add(new NotableItem(
                          grouping.format(lastYear) + " GitHub contributions in the last year",
                          "GITHUB"));
              }
              int externalPRs = g.path("externalPRs").asInt(0);
              if (externalPRs > 0) {
                  notable.add(new NotableItem(
                          externalPRs + " external pull request contributions to other projects",
                          "GITHUB"));
              }

              // most-used skills from language percentages, evidence names the source
              for (JsonNode lang : g.path("languages")) {
                  String name = lang.path("name").asString("");
                  int pct = lang.path("pct").asInt(0);
                  if (!name.isEmpty()) {
                      skills.add(new SkillItem(name, "GitHub " + pct + "%"));
                  }
              }

              // at-a-glance: top languages across repo count (descriptive, no comparison)
              int publicRepos = g.path("publicRepos").asInt(0);
              List<String> topLangs = new ArrayList<>();
              for (JsonNode lang : g.path("languages")) {
                  topLangs.add(lang.path("name").asString(""));
                  if (topLangs.size() == 2) {
                      break;
                  }
              }
              if (!topLangs.isEmpty()) {
                  atAGlance.add("Most active in " + String.join(" and ", topLangs)
                          + " across " + publicRepos + " repos");
              }
          });

          return new Bands(notable, skills, atAGlance);
      }
  }
  ```

- [ ] **Step 4.6: Run the test — expect PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest=RuleBasedProfileAssemblerTest test
  ```
  Expected: `Tests run: 5, Failures: 0, Errors: 0, Skipped: 0`, `BUILD SUCCESS`.

- [ ] **Step 4.7: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/assembler src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/NotableItem.java src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/SkillItem.java src/test/java/com/interviewiq/interviewiq_backend/profile/assembler
  git commit -m "feat(profile): rule-based ProfileAssembler (descriptive, no scoring)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5: OAuth state + GitHubOAuthService

**Files:**
- Create: `src/main/java/.../profile/github/OAuthStateService.java`
- Create: `src/main/java/.../profile/github/GitHubOAuthService.java`

- [ ] **Step 5.1: Implement `OAuthStateService` (HMAC-signed CSRF state).**
  The `state` carries the user UUID + a timestamp, signed with the JWT secret (already in env) so the callback can verify it without server-side storage. Create `src/main/java/com/interviewiq/interviewiq_backend/profile/github/OAuthStateService.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.github;

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
  ```

- [ ] **Step 5.2: Add a shared `RestClient` bean.**
  GitHub returns JSON only when asked; we configure a plain `RestClient` once and inject it. Create `src/main/java/com/interviewiq/interviewiq_backend/profile/github/GitHubOAuthService.java` together with the bean it needs. First, the bean — add to existing `JwtConfig`? No: keep it co-located in a small config. Create `src/main/java/com/interviewiq/interviewiq_backend/config/RestClientConfig.java`:
  ```java
  package com.interviewiq.interviewiq_backend.config;

  import org.springframework.context.annotation.Bean;
  import org.springframework.context.annotation.Configuration;
  import org.springframework.web.client.RestClient;

  @Configuration
  public class RestClientConfig {

      @Bean
      public RestClient restClient() {
          return RestClient.builder()
                  .defaultHeader("Accept", "application/json")
                  .build();
      }
  }
  ```

- [ ] **Step 5.3: Implement `GitHubOAuthService`.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/github/GitHubOAuthService.java`. It builds the authorize URL, exchanges the code, fetches the login, encrypts the token, and upserts the connection:
  ```java
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
  ```

- [ ] **Step 5.4: Compile.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -DskipTests compile
  ```
  Expected: no output, exit code 0.

- [ ] **Step 5.5: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/github/OAuthStateService.java src/main/java/com/interviewiq/interviewiq_backend/profile/github/GitHubOAuthService.java src/main/java/com/interviewiq/interviewiq_backend/config/RestClientConfig.java
  git commit -m "feat(profile): GitHub OAuth service with signed CSRF state + RestClient bean

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 6: ProfileService + remaining DTOs

**Files:**
- Create: `src/main/java/.../profile/web/dto/ProfileUser.java`
- Create: `src/main/java/.../profile/web/dto/SourceStatus.java`
- Create: `src/main/java/.../profile/web/dto/ProvenanceItem.java`
- Create: `src/main/java/.../profile/web/dto/ProfileResponse.java`
- Create: `src/main/java/.../profile/service/ProfileService.java`

- [ ] **Step 6.1: Create the remaining DTOs (exact §6 field names).**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/ProfileUser.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web.dto;

  public record ProfileUser(String name, String headline) {
  }
  ```
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/SourceStatus.java` (omit `lastRefreshedAt` from JSON when null, per §6 unconnected sources):
  ```java
  package com.interviewiq.interviewiq_backend.profile.web.dto;

  import com.fasterxml.jackson.annotation.JsonInclude;

  import java.time.Instant;

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record SourceStatus(String source, boolean connected, Instant lastRefreshedAt) {
  }
  ```
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/ProvenanceItem.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web.dto;

  import java.time.Instant;

  public record ProvenanceItem(String source, String fragmentHash, Instant fetchedAt) {
  }
  ```
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto/ProfileResponse.java`. `fragments` is a `Map<String, JsonNode>` so the stored GitHub fragment JSON is emitted verbatim under key `github`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web.dto;

  import tools.jackson.databind.JsonNode;

  import java.util.List;
  import java.util.Map;

  public record ProfileResponse(
          ProfileUser user,
          List<SourceStatus> sources,
          List<NotableItem> notable,
          List<SkillItem> mostUsedSkills,
          List<String> atAGlance,
          Map<String, JsonNode> fragments,
          List<ProvenanceItem> provenance
  ) {
  }
  ```
  Note: the `@JsonInclude` annotation import is `com.fasterxml.jackson.annotation.JsonInclude` (Jackson 3 keeps annotations in the `com.fasterxml.jackson.annotation` package even though databind moved to `tools.jackson`).

- [ ] **Step 6.2: Implement `ProfileService`.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/service/ProfileService.java`. It enumerates all five sources (GITHUB live, others as not-connected placeholders), assembles bands, and emits the fragment + provenance:
  ```java
  package com.interviewiq.interviewiq_backend.profile.service;

  import com.interviewiq.interviewiq_backend.models.User;
  import com.interviewiq.interviewiq_backend.profile.assembler.ProfileAssembler;
  import com.interviewiq.interviewiq_backend.profile.github.GitHubCollector;
  import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
  import com.interviewiq.interviewiq_backend.profile.model.ProfileFragment;
  import com.interviewiq.interviewiq_backend.profile.model.ProfileSource;
  import com.interviewiq.interviewiq_backend.profile.repository.GitHubConnectionRepository;
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
      private final ProfileFragmentRepository fragmentRepository;
      private final GitHubCollector gitHubCollector;
      private final ProfileAssembler profileAssembler;
      private final ObjectMapper objectMapper;

      public ProfileService(
              UserService userService,
              GitHubConnectionRepository connectionRepository,
              ProfileFragmentRepository fragmentRepository,
              GitHubCollector gitHubCollector,
              ProfileAssembler profileAssembler,
              ObjectMapper objectMapper) {
          this.userService = userService;
          this.connectionRepository = connectionRepository;
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

          List<SourceStatus> sources = new ArrayList<>();
          sources.add(new SourceStatus(
                  ProfileSource.GITHUB.name(),
                  github.isPresent(),
                  github.map(GitHubConnection::getLastRefreshedAt).orElse(null)));
          sources.add(new SourceStatus(ProfileSource.RESUME.name(), false, null));
          sources.add(new SourceStatus(ProfileSource.LEETCODE.name(), false, null));
          sources.add(new SourceStatus(ProfileSource.LINKEDIN.name(), false, null));
          sources.add(new SourceStatus(ProfileSource.X.name(), false, null));

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
  ```

- [ ] **Step 6.3: Compile.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -DskipTests compile
  ```
  Expected: no output, exit code 0.

- [ ] **Step 6.4: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/web/dto src/main/java/com/interviewiq/interviewiq_backend/profile/service/ProfileService.java
  git commit -m "feat(profile): ProfileResponse DTOs + ProfileService orchestration

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 7: Controllers — connections + profile read

**Files:**
- Create: `src/main/java/.../profile/web/GitHubConnectionController.java`
- Create: `src/main/java/.../profile/web/ProfileController.java`

- [ ] **Step 7.1: Implement `ProfileController`.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/ProfileController.java`. It mirrors the API-version convention (`/api/{version}/...`, `version = "1"`) and reads the user from the JWT subject:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web;

  import com.interviewiq.interviewiq_backend.profile.service.ProfileService;
  import com.interviewiq.interviewiq_backend.profile.web.dto.ProfileResponse;
  import org.springframework.http.ResponseEntity;
  import org.springframework.security.core.annotation.AuthenticationPrincipal;
  import org.springframework.security.oauth2.jwt.Jwt;
  import org.springframework.web.bind.annotation.GetMapping;
  import org.springframework.web.bind.annotation.RequestMapping;
  import org.springframework.web.bind.annotation.RestController;

  import java.util.UUID;

  @RestController
  @RequestMapping(value = "/api/{version}/profile", version = "1")
  public class ProfileController {

      private final ProfileService profileService;

      public ProfileController(ProfileService profileService) {
          this.profileService = profileService;
      }

      @GetMapping("/me")
      public ResponseEntity<ProfileResponse> me(@AuthenticationPrincipal Jwt jwt) {
          UUID userId = UUID.fromString(jwt.getSubject());
          return ResponseEntity.ok(profileService.getProfile(userId));
      }
  }
  ```

- [ ] **Step 7.2: Implement `GitHubConnectionController`.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/web/GitHubConnectionController.java`. `authorize` 302s to GitHub; `callback` exchanges + fetches synchronously then 302s back to the frontend; `DELETE` returns 204:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web;

  import com.interviewiq.interviewiq_backend.profile.github.GitHubOAuthService;
  import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
  import com.interviewiq.interviewiq_backend.profile.service.ProfileService;
  import org.springframework.beans.factory.annotation.Value;
  import org.springframework.http.HttpStatus;
  import org.springframework.http.ResponseEntity;
  import org.springframework.security.core.annotation.AuthenticationPrincipal;
  import org.springframework.security.oauth2.jwt.Jwt;
  import org.springframework.web.bind.annotation.*;
  import org.springframework.web.servlet.view.RedirectView;
  import org.springframework.web.util.UriComponentsBuilder;

  import java.net.URI;
  import java.util.UUID;

  @RestController
  @RequestMapping(value = "/api/{version}/connections/github", version = "1")
  public class GitHubConnectionController {

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

      /** 302 -> GitHub authorize. Requires a valid Bearer JWT. */
      @GetMapping("/authorize")
      public ResponseEntity<Void> authorize(@AuthenticationPrincipal Jwt jwt) {
          UUID userId = UUID.fromString(jwt.getSubject());
          String url = gitHubOAuthService.buildAuthorizeUrl(userId);
          return ResponseEntity.status(HttpStatus.FOUND).location(URI.create(url)).build();
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
  ```

- [ ] **Step 7.3: Compile.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -DskipTests compile
  ```
  Expected: no output, exit code 0.

- [ ] **Step 7.4: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/web/ProfileController.java src/main/java/com/interviewiq/interviewiq_backend/profile/web/GitHubConnectionController.java
  git commit -m "feat(profile): connection + profile controllers

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 8: SecurityConfig — permit callback, keep existing rules

**Files:**
- Modify: `src/main/java/.../config/SecurityConfig.java`

- [ ] **Step 8.1: Add the callback to the permit-list.**
  The callback arrives as a browser redirect from GitHub with no Bearer token; it must be permitted (the signed `state` provides CSRF protection). All other connection endpoints + `/profile/me` fall under the existing `anyRequest().authenticated()` rule and use the resource-server JWT. Edit `src/main/java/com/interviewiq/interviewiq_backend/config/SecurityConfig.java`, changing only the `authorizeHttpRequests` block:
  ```java
                  .authorizeHttpRequests(auth -> auth
                          .requestMatchers("/api/v1/main/healthcheck").permitAll()
                          .requestMatchers("/oauth2/**", "/login/oauth2/**").permitAll()
                          .requestMatchers("/api/v1/auth/refresh", "/api/v1/auth/logout").permitAll()
                          .requestMatchers("/api/v1/connections/github/callback").permitAll()
                          .anyRequest().authenticated()
                  )
  ```
  Leave the rest of the file (CORS bean, oauth2Login, oauth2ResourceServer, csrf disable) exactly as-is.

- [ ] **Step 8.2: Compile.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -DskipTests compile
  ```
  Expected: no output, exit code 0.

- [ ] **Step 8.3: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/config/SecurityConfig.java
  git commit -m "feat(profile): permit GitHub OAuth callback in SecurityConfig

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 9: ProfileController @WebMvcTest — /me shape (TDD)

Note: this is a characterization/slice test that verifies the existing controller's `/me` response shape (the controller was already built in Task 7), not strict red-green TDD — expect it to PASS immediately rather than FAIL first.

**Files:**
- Test: `src/test/java/.../profile/web/ProfileControllerTest.java`

- [ ] **Step 9.1: Write the failing test.**
  This slices the web layer, mocks `ProfileService`, and supplies a JWT principal via `spring-security-test`. Create `src/test/java/com/interviewiq/interviewiq_backend/profile/web/ProfileControllerTest.java`:
  ```java
  package com.interviewiq.interviewiq_backend.profile.web;

  import com.interviewiq.interviewiq_backend.profile.service.ProfileService;
  import com.interviewiq.interviewiq_backend.profile.web.dto.*;
  import org.junit.jupiter.api.Test;
  import org.springframework.beans.factory.annotation.Autowired;
  import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
  import org.springframework.boot.test.mock.mockito.MockitoBean;
  import org.springframework.context.annotation.Import;
  import org.springframework.security.config.annotation.web.builders.HttpSecurity;
  import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
  import org.springframework.security.web.SecurityFilterChain;
  import org.springframework.context.annotation.Bean;
  import org.springframework.context.annotation.Configuration;
  import org.springframework.test.web.servlet.MockMvc;
  import tools.jackson.databind.ObjectMapper;

  import java.time.Instant;
  import java.util.List;
  import java.util.Map;
  import java.util.UUID;

  import static org.mockito.Mockito.when;
  import static org.springframework.security.config.Customizer.withDefaults;
  import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
  import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
  import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

  @WebMvcTest(controllers = ProfileController.class)
  @Import(ProfileControllerTest.TestSecurityConfig.class)
  class ProfileControllerTest {

      @Autowired
      MockMvc mockMvc;

      @MockitoBean
      ProfileService profileService;

      private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

      @Configuration
      @EnableWebSecurity
      static class TestSecurityConfig {
          @Bean
          SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
              return http
                      .csrf(c -> c.disable())
                      .authorizeHttpRequests(a -> a.anyRequest().authenticated())
                      .oauth2ResourceServer(rs -> rs.jwt(withDefaults()))
                      .build();
          }
      }

      private ProfileResponse sampleResponse() {
          ObjectMapper om = new ObjectMapper();
          return new ProfileResponse(
                  new ProfileUser("Aisha Verma", null),
                  List.of(
                          new SourceStatus("GITHUB", true, Instant.parse("2026-06-01T00:00:00Z")),
                          new SourceStatus("RESUME", false, null),
                          new SourceStatus("LEETCODE", false, null),
                          new SourceStatus("LINKEDIN", false, null),
                          new SourceStatus("X", false, null)),
                  List.of(new NotableItem("1,204 GitHub contributions in the last year", "GITHUB")),
                  List.of(new SkillItem("TypeScript", "GitHub 48%")),
                  List.of("Most active in TypeScript and Python across 38 repos"),
                  Map.of("github", om.readTree("{\"login\":\"aishav\",\"publicRepos\":38}")),
                  List.of(new ProvenanceItem("GITHUB", "sha256:abc", Instant.parse("2026-06-01T00:00:00Z"))));
      }

      @Test
      void me_returnsConsolidatedProfileShape() throws Exception {
          when(profileService.getProfile(USER_ID)).thenReturn(sampleResponse());

          mockMvc.perform(get("/api/v1/profile/me")
                          .with(jwt().jwt(j -> j.subject(USER_ID.toString()))))
                  .andExpect(status().isOk())
                  .andExpect(jsonPath("$.user.name").value("Aisha Verma"))
                  .andExpect(jsonPath("$.user.headline").doesNotExist())
                  .andExpect(jsonPath("$.sources[0].source").value("GITHUB"))
                  .andExpect(jsonPath("$.sources[0].connected").value(true))
                  .andExpect(jsonPath("$.sources[1].source").value("RESUME"))
                  .andExpect(jsonPath("$.sources[1].connected").value(false))
                  .andExpect(jsonPath("$.sources[1].lastRefreshedAt").doesNotExist())
                  .andExpect(jsonPath("$.notable[0].text").value("1,204 GitHub contributions in the last year"))
                  .andExpect(jsonPath("$.notable[0].source").value("GITHUB"))
                  .andExpect(jsonPath("$.mostUsedSkills[0].skill").value("TypeScript"))
                  .andExpect(jsonPath("$.mostUsedSkills[0].evidence").value("GitHub 48%"))
                  .andExpect(jsonPath("$.atAGlance[0]").value("Most active in TypeScript and Python across 38 repos"))
                  .andExpect(jsonPath("$.fragments.github.publicRepos").value(38))
                  .andExpect(jsonPath("$.provenance[0].fragmentHash").value("sha256:abc"))
                  // hard rule: no scoring anywhere
                  .andExpect(jsonPath("$.score").doesNotExist())
                  .andExpect(jsonPath("$.rank").doesNotExist());
      }

      @Test
      void me_withoutJwt_isUnauthorized() throws Exception {
          mockMvc.perform(get("/api/v1/profile/me"))
                  .andExpect(status().isUnauthorized());
      }
  }
  ```
  Note: `@MockitoBean` is the Spring Boot 3.4+/4 replacement for the removed `@MockBean`; this repo is Boot 4 so use `@MockitoBean` (`org.springframework.boot.test.mock.mockito.MockitoBean`). If the import does not resolve, the class lives in `spring-boot-test`; confirm with `jar tf "$(find ~/.m2/repository -name 'spring-boot-test-*.jar' | grep -v autoconfigure | head -1)" | grep -i mockitobean`.

- [ ] **Step 9.2: Run the test — expect FAIL first, then PASS.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest=ProfileControllerTest test
  ```
  Because the controller already exists (Task 7), this should compile and PASS immediately:
  Expected: `Tests run: 2, Failures: 0, Errors: 0, Skipped: 0`, `BUILD SUCCESS`.
  If `@MockitoBean` does not resolve, the alternative import is `org.springframework.test.context.bean.override.mockito.MockitoBean` (Spring Framework 6.2+/7). Try that import and re-run.

- [ ] **Step 9.3: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/test/java/com/interviewiq/interviewiq_backend/profile/web/ProfileControllerTest.java
  git commit -m "test(profile): @WebMvcTest for GET /api/v1/profile/me shape

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 10: Weekly @Scheduled refresh

**Files:**
- Create: `src/main/java/.../profile/service/ProfileRefreshScheduler.java`

- [ ] **Step 10.1: Implement the scheduler.**
  Create `src/main/java/com/interviewiq/interviewiq_backend/profile/service/ProfileRefreshScheduler.java`. It iterates all GitHub connections weekly and re-collects (the collector's hash check makes this cheap when nothing changed). Each connection is refreshed independently so one failure doesn't abort the batch:
  ```java
  package com.interviewiq.interviewiq_backend.profile.service;

  import com.interviewiq.interviewiq_backend.profile.model.GitHubConnection;
  import com.interviewiq.interviewiq_backend.profile.repository.GitHubConnectionRepository;
  import org.slf4j.Logger;
  import org.slf4j.LoggerFactory;
  import org.springframework.scheduling.annotation.Scheduled;
  import org.springframework.stereotype.Component;

  import java.util.List;

  @Component
  public class ProfileRefreshScheduler {

      private static final Logger log = LoggerFactory.getLogger(ProfileRefreshScheduler.class);

      private final GitHubConnectionRepository connectionRepository;
      private final ProfileService profileService;

      public ProfileRefreshScheduler(
              GitHubConnectionRepository connectionRepository,
              ProfileService profileService) {
          this.connectionRepository = connectionRepository;
          this.profileService = profileService;
      }

      /** Weekly background refresh of every GitHub connection. fixedRate = 7 days in ms. */
      @Scheduled(fixedRate = 7L * 24 * 60 * 60 * 1000, initialDelay = 60_000)
      public void refreshAllGitHubConnections() {
          List<GitHubConnection> connections = connectionRepository.findAll();
          log.info("Weekly GitHub refresh starting for {} connection(s)", connections.size());
          for (GitHubConnection connection : connections) {
              try {
                  profileService.refreshGitHub(connection);
              } catch (RuntimeException ex) {
                  // never log the token; log only the (non-sensitive) login + message
                  log.warn("GitHub refresh failed for login={}: {}",
                          connection.getGithubLogin(), ex.getMessage());
              }
          }
          log.info("Weekly GitHub refresh complete");
      }
  }
  ```

- [ ] **Step 10.2: Compile.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -DskipTests compile
  ```
  Expected: no output, exit code 0.

- [ ] **Step 10.3: Commit.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git add src/main/java/com/interviewiq/interviewiq_backend/profile/service/ProfileRefreshScheduler.java
  git commit -m "feat(profile): weekly @Scheduled GitHub refresh job

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 11: Full test suite (excluding DB-bound context test) + manual smoke

**Files:** none (verification).

- [ ] **Step 11.1: Run all the new unit + slice tests together.**
  These four classes need no DB and no network:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q -Dtest='TokenCipherTest,GitHubCollectorTest,RuleBasedProfileAssemblerTest,ProfileControllerTest' test
  ```
  Expected: `Tests run: 15, Failures: 0, Errors: 0, Skipped: 0` and `BUILD SUCCESS` (3+5+5+2 = 15).

- [ ] **Step 11.2: (Optional, requires reachable Supabase `.env`) Full build.**
  The existing `contextLoads()` test needs the DB; run it only where `.env` is valid:
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw -q test
  ```
  Expected (with DB reachable): all tests pass. If the DB is unreachable in CI, scope CI to the four new classes via `-Dtest=...` as in Step 11.1.

- [ ] **Step 11.3: (Manual smoke, requires real GitHub OAuth App + JWT) End-to-end connect.**
  Start the app: `cd /Users/salescode/Desktop/project/interviewiq-backend && ./mvnw spring-boot:run`. With a valid access-token JWT (from the existing Google login → `/api/v1/auth/refresh`), hit `GET http://localhost:8080/api/v1/connections/github/authorize` with `Authorization: Bearer <jwt>` → expect `302` to `github.com/login/oauth/authorize?...&state=...`. Complete consent → browser lands on `http://localhost:3000/connections` (no `?error=`). Then `GET /api/v1/profile/me` with the JWT → expect `200` with `sources[0].connected = true` and a populated `fragments.github`. This is documented for the implementer; it is not a CI gate.

- [ ] **Step 11.4: Final verification of "no scoring" across the slice.**
  Grep the new package for forbidden comparative vocabulary (should return nothing):
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend && grep -rniE '\b(score|ranking|percentile|grade|tier_vs_peers|better than|above average)\b' src/main/java/com/interviewiq/interviewiq_backend/profile || echo "CLEAN: no scoring vocabulary"
  ```
  Expected: `CLEAN: no scoring vocabulary`.

- [ ] **Step 11.5: Commit any final touch-ups and open the PR.**
  ```bash
  cd /Users/salescode/Desktop/project/interviewiq-backend
  git push -u origin feat/github-profile-builder-backend
  gh pr create --title "feat(profile): GitHub Profile Builder backend vertical slice" --body "$(cat <<'EOF'
  ## Summary
  - New `profile` package: GitHubConnection + ProfileFragment entities, AES-256-GCM TokenCipher, GitHub OAuth (separate from Google login) with signed CSRF state, GitHubCollector (one GraphQL query -> normalized fragment + SHA-256 hash, upsert-on-change), rule-based ProfileAssembler (descriptive, never scored), ProfileService, controllers, and a weekly @Scheduled refresh.
  - `GET /api/v1/profile/me` returns the consolidated descriptive profile (spec §6). No scoring/ranking anywhere.
  - SecurityConfig permits the GitHub OAuth callback only; all other endpoints require the Bearer JWT.

  ## Decisions / flags (per CLAUDE.md stop-and-ask)
  - Token storage: AES-256-GCM with env key (`GITHUB_TOKEN_KEY`), `read:user` scope — approved in brainstorming; KMS is the prod upgrade path.
  - JSONB stored as a String column + ObjectMapper (Jackson 3 / Hibernate 7 version-safe), not raw JsonNode mapping.
  - No new pom dependency added (RestClient + Jackson + JPA + security already present).

  ## Testing
  - TokenCipher round-trip + tamper, GitHubCollector fixture mapping + hash stability, ProfileAssembler no-scoring, ProfileController @WebMvcTest /me shape. All four classes run without a DB.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
  Expected: `gh` prints the new PR URL.

---

## Notes for the implementer (gotchas, restated)

1. **Jackson 3 imports:** `ObjectMapper`, `JsonNode`, `SerializationFeature`, `ArrayNode`, `ObjectNode` are all under `tools.jackson.databind.*`; `JacksonException` under `tools.jackson.core`. Annotations (`@JsonInclude`) stay under `com.fasterxml.jackson.annotation`. The auto-configured Spring bean is the `tools.jackson` `ObjectMapper` — inject it, don't `new` one in production code (the test classes use `new ObjectMapper()` only because they don't load Spring).
2. **No checked Jackson exceptions:** do not add `throws`/`try-catch` around `readTree`, `writeValueAsString`, `treeToValue`, `readValue` for checked-exception reasons. They throw the unchecked `tools.jackson.core.JacksonException`.
3. **`JsonNode` accessor names in Jackson 3:** `asString(default)`, `asInt(default)`, `asLong(default)`, `asBoolean(default)`, `path(...)`, `propertyNames()`. If any name differs in 3.1.2, run `javap` on `tools.jackson.databind.JsonNode` (command in Step 3.6) and adjust — the structure of the code is unaffected.
4. **API version path:** the literal request path is `/api/v1/...`; the annotation uses the `{version}` placeholder with `version = "1"`. Tests and `permitAll` matchers use the resolved `/api/v1/...` form.
5. **Schema:** `ddl-auto=update` creates `github_connection` and `profile_fragment` automatically on first boot; no migration file is needed in this repo.
6. **Never log the token.** The scheduler logs only `githubLogin` + message; the entity field `accessTokenEnc` never appears in any DTO.