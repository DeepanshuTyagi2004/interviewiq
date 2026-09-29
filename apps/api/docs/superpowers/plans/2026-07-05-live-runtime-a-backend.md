# Live Runtime (Sub-project A) — Backend Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend live-interview surface — live session states, a LiveKit join-token endpoint, and an internal outcome-ingest endpoint — so a `PREP_READY` session can be taken live and its `SessionOutcome` persisted. No live logic runs here; this is the lifecycle + token + persistence layer the frontend and the Python worker consume.

**Architecture:** The frontend calls `POST /api/v1/interviews/sessions/{id}/live` → backend validates ownership + `PREP_READY`, mints a LiveKit **AccessToken** for room `interview-{sessionId}`, flips the session to `LIVE_IN_PROGRESS`, and returns `{livekitUrl, token, roomName}`. The Python LiveKit Agents worker uses **automatic dispatch** (joins the room, parses the sessionId from the room name) — so the backend never calls LiveKit's room/dispatch APIs, only mints tokens (pure, unit-testable). When the interview ends, the worker POSTs the `SessionOutcome` to `POST /api/v1/internal/sessions/{id}/outcome` (guarded by `X-Internal-Api-Key`); the backend stores it in a jsonb column and flips the session to `COMPLETED`/`ABORTED_TECHNICAL`.

**Tech Stack:** Java 25, Spring Boot 4.0.6, Hibernate 7, Jackson 3 (`tools.jackson.*`), Lombok (entities only), Postgres via `ddl-auto=update` (no Flyway), `io.livekit:livekit-server` (new dep — token minting), JUnit 5 + Mockito + `@WebMvcTest`.

## Global Constraints

- **No DB in tests.** This repo has zero `@DataJpaTest`/H2/Testcontainers. Every new test is a Mockito **service** test (`@ExtendWith(MockitoExtension.class)`) or a **`@WebMvcTest`** slice. The jsonb round-trip is exercised only at runtime against real Postgres — do NOT add a DB test.
- **DTOs are Java `record`s** in `dtos/`, camelCase fields, **no** validation annotations, **no** Lombok. Entities use Lombok `@Getter/@Setter/@NoArgsConstructor`.
- **Jackson is `tools.jackson.databind.*` (v3)** — never `com.fasterxml.jackson.*`. Do NOT add Jackson or Nimbus deps (already transitive).
- **SessionStatus** is persisted `@Enumerated(EnumType.STRING) @Column(nullable=false, length=24)`. New values are append-only.
- **New entity columns MUST be nullable** (`ddl-auto=update` NOT-NULL on a populated table fails). jsonb columns are `String` fields with `columnDefinition = "jsonb"`; they rely on the existing `spring.datasource.hikari.data-source-properties.stringtype=unspecified` (already set — do not remove).
- **Candidate endpoints** read `@AuthenticationPrincipal Jwt jwt` → `UUID.fromString(jwt.getSubject())`; the **service** owner-scopes via `sessionRepository.findByIdAndCandidateId(sessionId, candidateId)` and throws `InterviewSessionException.notFound()` (→ 404) on miss.
- **Internal endpoints** live under `/api/v1/internal/**` (already `permitAll` in `SecurityConfig`) and self-guard with a constant-time `X-Internal-Api-Key` check (`@Value("${internal.api-key}")` + `MessageDigest.isEqual`), returning `401 ApiError("invalid_internal_key", …)` on mismatch. No JWT principal on internal endpoints.
- **Web-test security:** each `@WebMvcTest` declares its own nested `@TestConfiguration @EnableWebSecurity TestSecurityConfig` with a mocked `JwtDecoder` (copy from `InterviewSessionControllerTest`). Web tests must set `properties = "spring.mvc.apiversion.use.path-segment=1"`. Use `@MockitoBean` (not `@MockBean`) and `.with(jwt().jwt(j -> j.subject(id.toString())))`.
- **`ended_reason`** arrives snake_case from the worker: `natural_complete | early_weak | time_ceiling | aborted_technical`. Map `aborted_technical → SessionStatus.ABORTED_TECHNICAL`; all others → `COMPLETED`. Store the raw snake_case string in the `ended_reason` column.
- **Run tests:** `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='<Classes>'` (JDK 25 is required; plain `java` on PATH is 17 and fails). Full suite (`./mvnw test`) additionally needs Supabase creds for the lone `contextLoads` `@SpringBootTest` — scope to `-Dtest=` for the new classes to stay DB-free.
- **New dependency note:** `io.livekit:livekit-server` is the first third-party dep needing an explicit `<version>` (everything else is Spring-BOM-managed). Verify the latest GAV/version and the `AccessToken` API via the context7 MCP (`resolve-library-id` → `livekit server sdk` / `server-sdk-kotlin`) before pinning.

## File Structure

- `models/SessionStatus.java` — **modify**: add `LIVE_IN_PROGRESS`, `COMPLETED`, `ABORTED_TECHNICAL`.
- `models/InterviewSession.java` — **modify**: add nullable live/outcome columns.
- `dtos/LiveSessionResponse.java` — **create**: `{ livekitUrl, token, roomName, status }`.
- `integrations/livekit/LiveKitTokenService.java` — **create**: mints a LiveKit `AccessToken` (interface + impl in one file or an interface + impl pair; kept behind a narrow method so services mock it trivially).
- `services/LiveSessionService.java` — **create**: `startLive`, `getLive`, `recordOutcome`.
- `services/LiveSessionException.java` — **create**: domain exception carrying `status()` + `code()` (mirror `InterviewSessionException`), OR reuse `InterviewSessionException` if it already exposes generic `badRequest`/`notFound`/`conflict` factories. Prefer reuse — check first.
- `controllers/InterviewSessionController.java` — **modify**: add `POST /sessions/{id}/live` + `GET /sessions/{id}/live`.
- `controllers/InternalLiveSessionController.java` — **create**: `POST /internal/sessions/{id}/outcome`.
- `src/main/resources/application.properties` — **modify**: add `livekit.*`.
- `.env.example` — **modify**: add `LIVEKIT_*`.
- `pom.xml` — **modify**: add `io.livekit:livekit-server`.
- Tests: `services/LiveSessionServiceTest.java`, `controllers/InterviewSessionLiveControllerTest.java`, `controllers/InternalLiveSessionControllerTest.java`, `integrations/livekit/LiveKitTokenServiceTest.java`.

---

### Task 1: Domain — live session states + outcome columns + response DTO

**Files:**
- Modify: `src/main/java/com/interviewiq/interviewiq_backend/models/SessionStatus.java`
- Modify: `src/main/java/com/interviewiq/interviewiq_backend/models/InterviewSession.java`
- Create: `src/main/java/com/interviewiq/interviewiq_backend/dtos/LiveSessionResponse.java`
- Test: `src/test/java/com/interviewiq/interviewiq_backend/models/InterviewSessionLiveFieldsTest.java`

**Interfaces:**
- Produces: `SessionStatus.LIVE_IN_PROGRESS|COMPLETED|ABORTED_TECHNICAL`; `InterviewSession` getters/setters `liveStartedAt:Instant`, `liveEndedAt:Instant`, `endedReason:String`, `livekitRoom:String`, `liveScoreFinal:Double`, `durationS:Integer`, `outcome:String`; `LiveSessionResponse(String livekitUrl, String token, String roomName, SessionStatus status)`.

- [ ] **Step 1: Write the failing test**

`src/test/java/com/interviewiq/interviewiq_backend/models/InterviewSessionLiveFieldsTest.java`:
```java
package com.interviewiq.interviewiq_backend.models;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;

class InterviewSessionLiveFieldsTest {

    @Test
    void liveStatesExist() {
        assertEquals("LIVE_IN_PROGRESS", SessionStatus.LIVE_IN_PROGRESS.name());
        assertEquals("COMPLETED", SessionStatus.COMPLETED.name());
        assertEquals("ABORTED_TECHNICAL", SessionStatus.ABORTED_TECHNICAL.name());
    }

    @Test
    void liveAndOutcomeFieldsRoundTrip() {
        InterviewSession s = new InterviewSession();
        Instant now = Instant.now();
        s.setStatus(SessionStatus.LIVE_IN_PROGRESS);
        s.setLiveStartedAt(now);
        s.setLiveEndedAt(now);
        s.setEndedReason("natural_complete");
        s.setLivekitRoom("interview-abc");
        s.setLiveScoreFinal(0.72);
        s.setDurationS(1830);
        s.setOutcome("{\"session_id\":\"abc\"}");

        assertEquals(SessionStatus.LIVE_IN_PROGRESS, s.getStatus());
        assertEquals(now, s.getLiveStartedAt());
        assertEquals(now, s.getLiveEndedAt());
        assertEquals("natural_complete", s.getEndedReason());
        assertEquals("interview-abc", s.getLivekitRoom());
        assertEquals(0.72, s.getLiveScoreFinal());
        assertEquals(1830, s.getDurationS());
        assertEquals("{\"session_id\":\"abc\"}", s.getOutcome());
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='InterviewSessionLiveFieldsTest' -o`
Expected: **compile failure** (`cannot find symbol` for the new enum values / setters).

- [ ] **Step 3: Add the enum values**

In `SessionStatus.java`, append (keep existing four first):
```java
public enum SessionStatus {
    SCHEDULED,
    PREP_QUEUED,
    PREP_READY,
    PREP_FAILED,
    LIVE_IN_PROGRESS,
    COMPLETED,
    ABORTED_TECHNICAL
}
```

- [ ] **Step 4: Add the entity columns**

In `InterviewSession.java`, add these fields alongside the existing ones (all nullable — see Global Constraints). Match the existing `@Column(name=...)` snake_case style:
```java
    @Column(name = "live_started_at")
    private Instant liveStartedAt;

    @Column(name = "live_ended_at")
    private Instant liveEndedAt;

    @Column(name = "ended_reason", length = 32)
    private String endedReason;

    @Column(name = "livekit_room")
    private String livekitRoom;

    @Column(name = "live_score_final")
    private Double liveScoreFinal;

    @Column(name = "duration_s")
    private Integer durationS;

    // Full SessionOutcome JSON from the worker, stored verbatim. Null until the interview finalizes.
    // Relies on hikari stringtype=unspecified for the String->jsonb cast (see application.properties).
    @Column(name = "outcome", columnDefinition = "jsonb")
    private String outcome;
```
(Lombok `@Getter/@Setter` on the class generate the accessors — do not hand-write them.)

- [ ] **Step 5: Create the response DTO**

`src/main/java/com/interviewiq/interviewiq_backend/dtos/LiveSessionResponse.java`:
```java
package com.interviewiq.interviewiq_backend.dtos;

import com.interviewiq.interviewiq_backend.models.SessionStatus;

/** Returned by the go-live / resume endpoints. `token`/`livekitUrl` are null when the session
 *  is not (yet) live (GET on a PREP_READY session). */
public record LiveSessionResponse(
        String livekitUrl,
        String token,
        String roomName,
        SessionStatus status
) {
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='InterviewSessionLiveFieldsTest' -o`
Expected: **PASS** (`Tests run: 2, Failures: 0`).

- [ ] **Step 7: Commit**
```bash
git add src/main/java/com/interviewiq/interviewiq_backend/models/SessionStatus.java \
        src/main/java/com/interviewiq/interviewiq_backend/models/InterviewSession.java \
        src/main/java/com/interviewiq/interviewiq_backend/dtos/LiveSessionResponse.java \
        src/test/java/com/interviewiq/interviewiq_backend/models/InterviewSessionLiveFieldsTest.java
git commit -m "feat(live): add live session states + outcome columns + LiveSessionResponse"
```

---

### Task 2: LiveKit token service (+ dependency & config)

**Files:**
- Modify: `pom.xml`
- Modify: `src/main/resources/application.properties`
- Modify: `.env.example`
- Create: `src/main/java/com/interviewiq/interviewiq_backend/integrations/livekit/LiveKitTokenService.java`
- Test: `src/test/java/com/interviewiq/interviewiq_backend/integrations/livekit/LiveKitTokenServiceTest.java`

**Interfaces:**
- Produces: `LiveKitTokenService.roomName(UUID sessionId): String` (returns `"interview-" + sessionId`), `LiveKitTokenService.mintCandidateToken(UUID sessionId, UUID candidateId): String` (a signed LiveKit JWT granting join to that room), `LiveKitTokenService.livekitUrl(): String`.
- Consumes: config `livekit.url`, `livekit.api-key`, `livekit.api-secret`.

- [ ] **Step 1: Add the dependency**

In `pom.xml`, add (verify the latest version + the `AccessToken` API first via context7 MCP: `resolve-library-id` "livekit server sdk", then `query-docs`; server-sdk-kotlin publishes as `io.livekit:livekit-server`):
```xml
        <dependency>
            <groupId>io.livekit</groupId>
            <artifactId>livekit-server</artifactId>
            <version>0.8.5</version>
        </dependency>
```

- [ ] **Step 2: Add config**

In `application.properties`, add (matching the `${ENV:default}` style; secrets have no default):
```properties
# --- LiveKit (Pipeline 2 live interview) ---
livekit.url=${LIVEKIT_URL:ws://localhost:7880}
livekit.api-key=${LIVEKIT_API_KEY}
livekit.api-secret=${LIVEKIT_API_SECRET}
```
In `.env.example`, add:
```properties
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>
```

- [ ] **Step 3: Write the failing test**

The token is a standard JWT signed HS256 with the API secret; decode it with Nimbus (already on the classpath) and assert the claims. `src/test/java/com/interviewiq/interviewiq_backend/integrations/livekit/LiveKitTokenServiceTest.java`:
```java
package com.interviewiq.interviewiq_backend.integrations.livekit;

import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class LiveKitTokenServiceTest {

    // >= 32 chars so HS256 accepts the key
    private static final String API_KEY = "APItestkey";
    private static final String API_SECRET = "test-secret-0123456789-0123456789-abc";

    private final LiveKitTokenService svc =
            new LiveKitTokenService("wss://x.livekit.cloud", API_KEY, API_SECRET);

    @Test
    void roomNameIsDerivedFromSessionId() {
        UUID sid = UUID.fromString("11111111-1111-1111-1111-111111111111");
        assertEquals("interview-11111111-1111-1111-1111-111111111111", svc.roomName(sid));
    }

    @Test
    void mintedTokenIsSignedAndCarriesJoinGrant() throws Exception {
        UUID sid = UUID.fromString("11111111-1111-1111-1111-111111111111");
        UUID cid = UUID.fromString("22222222-2222-2222-2222-222222222222");

        String jwt = svc.mintCandidateToken(sid, cid);

        SignedJWT parsed = SignedJWT.parse(jwt);
        assertTrue(parsed.verify(new MACVerifier(API_SECRET.getBytes())),
                "token must be HS256-signed with the api secret");
        var claims = parsed.getJWTClaimsSet();
        assertEquals(API_KEY, claims.getIssuer());          // LiveKit: iss = api key
        assertEquals(cid.toString(), claims.getSubject());   // sub = participant identity
        assertNotNull(claims.getClaim("video"));             // the room grant object
        assertNotNull(claims.getExpirationTime());
    }

    @Test
    void livekitUrlIsExposed() {
        assertEquals("wss://x.livekit.cloud", svc.livekitUrl());
    }
}
```
NOTE: if the LiveKit `AccessToken` API differs (grant class names, `toJwt()` vs `toJWT()`, ttl units), keep these **assertions** (they encode the LiveKit token spec: `iss`=api key, `sub`=identity, a `video` grant, an `exp`) and adjust the implementation call in Step 5. Confirm the grant claim key (`video`) via context7 if the assertion fails.

- [ ] **Step 4: Run it to verify it fails**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveKitTokenServiceTest' -o`
Expected: FAIL (class does not exist).

- [ ] **Step 5: Implement the service**

`src/main/java/com/interviewiq/interviewiq_backend/integrations/livekit/LiveKitTokenService.java` (verify the exact `AccessToken`/grant API via context7 — this is the standard server-sdk-kotlin usage from Java):
```java
package com.interviewiq.interviewiq_backend.integrations.livekit;

import io.livekit.server.AccessToken;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.UUID;

/** Mints LiveKit join tokens. The backend does NOT create rooms or dispatch agents:
 *  LiveKit auto-creates the room on first join and the Python worker uses automatic
 *  dispatch (parsing the sessionId from the room name "interview-{sessionId}"). */
@Service
public class LiveKitTokenService {

    private static final long TOKEN_TTL_MS = 60 * 60 * 1000L; // 1h

    private final String url;
    private final String apiKey;
    private final String apiSecret;

    public LiveKitTokenService(
            @Value("${livekit.url}") String url,
            @Value("${livekit.api-key}") String apiKey,
            @Value("${livekit.api-secret}") String apiSecret) {
        this.url = url;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
    }

    public String roomName(UUID sessionId) {
        return "interview-" + sessionId;
    }

    public String livekitUrl() {
        return url;
    }

    public String mintCandidateToken(UUID sessionId, UUID candidateId) {
        AccessToken token = new AccessToken(apiKey, apiSecret);
        token.setIdentity(candidateId.toString());
        token.setName(candidateId.toString());
        token.setTtl(TOKEN_TTL_MS);
        token.addGrants(new RoomJoin(true), new RoomName(roomName(sessionId)));
        return token.toJwt();
    }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveKitTokenServiceTest' -o`
Expected: PASS (`Tests run: 3`). If a claim key assertion fails, confirm the grant serialization key via context7 and update the test's claim name — do not weaken the "signed + has join grant + exp" intent.

- [ ] **Step 7: Commit**
```bash
git add pom.xml src/main/resources/application.properties .env.example \
        src/main/java/com/interviewiq/interviewiq_backend/integrations/livekit/LiveKitTokenService.java \
        src/test/java/com/interviewiq/interviewiq_backend/integrations/livekit/LiveKitTokenServiceTest.java
git commit -m "feat(live): LiveKit join-token service + config + dependency"
```

---

### Task 3: Go-live + resume endpoints & LiveSessionService

**Files:**
- Create: `src/main/java/com/interviewiq/interviewiq_backend/services/LiveSessionService.java`
- Modify: `src/main/java/com/interviewiq/interviewiq_backend/controllers/InterviewSessionController.java`
- Test: `src/test/java/com/interviewiq/interviewiq_backend/services/LiveSessionServiceTest.java`
- Test: `src/test/java/com/interviewiq/interviewiq_backend/controllers/InterviewSessionLiveControllerTest.java`

**Interfaces:**
- Consumes: `InterviewSessionRepository.findByIdAndCandidateId(UUID,UUID)`, `LiveKitTokenService` (Task 2), `SessionStatus`/`InterviewSession` fields (Task 1), `LiveSessionResponse` (Task 1), `InterviewSessionException` (existing — reuse its `notFound()` + a conflict/badRequest factory; if no conflict factory exists, add `conflict(code,msg)` returning HTTP 409).
- Produces: `LiveSessionService.startLive(UUID candidateId, UUID sessionId): LiveSessionResponse`, `LiveSessionService.getLive(UUID candidateId, UUID sessionId): LiveSessionResponse`. Endpoints `POST /api/v1/interviews/sessions/{sessionId}/live` (201/200) and `GET /api/v1/interviews/sessions/{sessionId}/live` (200).

- [ ] **Step 1: Write the failing service test**

`src/test/java/com/interviewiq/interviewiq_backend/services/LiveSessionServiceTest.java`:
```java
package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.LiveSessionResponse;
import com.interviewiq.interviewiq_backend.integrations.livekit.LiveKitTokenService;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class LiveSessionServiceTest {

    private static final UUID USER = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Mock InterviewSessionRepository sessionRepository;
    @Mock LiveKitTokenService liveKit;
    @InjectMocks LiveSessionService service;

    private InterviewSession session(SessionStatus status) {
        InterviewSession s = new InterviewSession();
        s.setCandidateId(USER);
        s.setStatus(status);
        return s;
    }

    @Test
    void startLive_fromPrepReady_mintsTokenFlipsToLiveAndReturnsConnection() {
        InterviewSession s = session(SessionStatus.PREP_READY);
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(s));
        when(sessionRepository.save(any())).thenAnswer(i -> i.getArgument(0));
        when(liveKit.roomName(sid)).thenReturn("interview-" + sid);
        when(liveKit.mintCandidateToken(sid, USER)).thenReturn("jwt-token");
        when(liveKit.livekitUrl()).thenReturn("wss://x.livekit.cloud");

        LiveSessionResponse resp = service.startLive(USER, sid);

        assertEquals("wss://x.livekit.cloud", resp.livekitUrl());
        assertEquals("jwt-token", resp.token());
        assertEquals("interview-" + sid, resp.roomName());
        assertEquals(SessionStatus.LIVE_IN_PROGRESS, resp.status());
        assertEquals(SessionStatus.LIVE_IN_PROGRESS, s.getStatus());
        assertNotNull(s.getLiveStartedAt());
        assertEquals("interview-" + sid, s.getLivekitRoom());
    }

    @Test
    void startLive_whenAlreadyLive_returnsFreshTokenWithoutChangingStartedAt() {
        InterviewSession s = session(SessionStatus.LIVE_IN_PROGRESS);
        java.time.Instant started = java.time.Instant.parse("2020-01-01T00:00:00Z");
        s.setLiveStartedAt(started);
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(s));
        when(liveKit.roomName(sid)).thenReturn("interview-" + sid);
        when(liveKit.mintCandidateToken(sid, USER)).thenReturn("jwt-2");
        when(liveKit.livekitUrl()).thenReturn("wss://x.livekit.cloud");

        LiveSessionResponse resp = service.startLive(USER, sid);

        assertEquals("jwt-2", resp.token());
        assertEquals(started, s.getLiveStartedAt(), "must not reset liveStartedAt on resume");
        verify(sessionRepository, never()).save(any());
    }

    @Test
    void startLive_whenNotReady_throwsConflict() {
        InterviewSession s = session(SessionStatus.SCHEDULED);
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(s));

        InterviewSessionException ex =
                assertThrows(InterviewSessionException.class, () -> service.startLive(USER, sid));
        assertEquals(409, ex.status().value());
    }

    @Test
    void startLive_whenNotOwned_throwsNotFound() {
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.empty());

        InterviewSessionException ex =
                assertThrows(InterviewSessionException.class, () -> service.startLive(USER, sid));
        assertEquals(404, ex.status().value());
    }

    @Test
    void getLive_whenLive_returnsToken_elseStatusOnly() {
        UUID sid = UUID.randomUUID();
        InterviewSession live = session(SessionStatus.LIVE_IN_PROGRESS);
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(live));
        when(liveKit.roomName(sid)).thenReturn("interview-" + sid);
        when(liveKit.mintCandidateToken(sid, USER)).thenReturn("jwt-3");
        when(liveKit.livekitUrl()).thenReturn("wss://x.livekit.cloud");

        LiveSessionResponse r1 = service.getLive(USER, sid);
        assertEquals("jwt-3", r1.token());
        assertEquals(SessionStatus.LIVE_IN_PROGRESS, r1.status());

        InterviewSession ready = session(SessionStatus.PREP_READY);
        when(sessionRepository.findByIdAndCandidateId(sid, USER)).thenReturn(Optional.of(ready));
        LiveSessionResponse r2 = service.getLive(USER, sid);
        assertNull(r2.token());
        assertEquals(SessionStatus.PREP_READY, r2.status());
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveSessionServiceTest' -o`
Expected: FAIL (class not found). If `InterviewSessionException` lacks a `conflict(...)` factory, add one returning `HttpStatus.CONFLICT` mirroring the existing `badRequest`/`notFound` (check the class first).

- [ ] **Step 3: Implement the service**

`src/main/java/com/interviewiq/interviewiq_backend/services/LiveSessionService.java`:
```java
package com.interviewiq.interviewiq_backend.services;

import com.interviewiq.interviewiq_backend.dtos.LiveSessionResponse;
import com.interviewiq.interviewiq_backend.integrations.livekit.LiveKitTokenService;
import com.interviewiq.interviewiq_backend.models.InterviewSession;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.repositories.InterviewSessionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

@Service
public class LiveSessionService {

    private final InterviewSessionRepository sessionRepository;
    private final LiveKitTokenService liveKit;

    public LiveSessionService(InterviewSessionRepository sessionRepository, LiveKitTokenService liveKit) {
        this.sessionRepository = sessionRepository;
        this.liveKit = liveKit;
    }

    private InterviewSession requireOwned(UUID candidateId, UUID sessionId) {
        return sessionRepository.findByIdAndCandidateId(sessionId, candidateId)
                .orElseThrow(InterviewSessionException::notFound);
    }

    private LiveSessionResponse connection(UUID sessionId, UUID candidateId, SessionStatus status) {
        return new LiveSessionResponse(
                liveKit.livekitUrl(),
                liveKit.mintCandidateToken(sessionId, candidateId),
                liveKit.roomName(sessionId),
                status);
    }

    @Transactional
    public LiveSessionResponse startLive(UUID candidateId, UUID sessionId) {
        InterviewSession s = requireOwned(candidateId, sessionId);
        if (s.getStatus() == SessionStatus.LIVE_IN_PROGRESS) {
            return connection(sessionId, candidateId, s.getStatus()); // resume: fresh token, no state change
        }
        if (s.getStatus() != SessionStatus.PREP_READY) {
            throw InterviewSessionException.conflict(
                    "session_not_ready", "session must be PREP_READY to go live");
        }
        s.setStatus(SessionStatus.LIVE_IN_PROGRESS);
        s.setLiveStartedAt(Instant.now());
        s.setLivekitRoom(liveKit.roomName(sessionId));
        sessionRepository.save(s);
        return connection(sessionId, candidateId, s.getStatus());
    }

    @Transactional(readOnly = true)
    public LiveSessionResponse getLive(UUID candidateId, UUID sessionId) {
        InterviewSession s = requireOwned(candidateId, sessionId);
        if (s.getStatus() == SessionStatus.LIVE_IN_PROGRESS) {
            return connection(sessionId, candidateId, s.getStatus());
        }
        return new LiveSessionResponse(null, null, null, s.getStatus());
    }
}
```

- [ ] **Step 4: Run the service test to verify it passes**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveSessionServiceTest' -o`
Expected: PASS (`Tests run: 5`).

- [ ] **Step 5: Write the failing controller test**

`src/test/java/com/interviewiq/interviewiq_backend/controllers/InterviewSessionLiveControllerTest.java` (copy the `TestSecurityConfig` pattern from `InterviewSessionControllerTest`):
```java
package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.LiveSessionResponse;
import com.interviewiq.interviewiq_backend.models.SessionStatus;
import com.interviewiq.interviewiq_backend.services.InterviewSessionService;
import com.interviewiq.interviewiq_backend.services.LiveSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(controllers = InterviewSessionController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1")
@Import(InterviewSessionControllerTest.TestSecurityConfig.class)
class InterviewSessionLiveControllerTest {

    private static final UUID USER = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired MockMvc mockMvc;
    @MockitoBean InterviewSessionService interviewSessionService; // controller ctor dep
    @MockitoBean LiveSessionService liveSessionService;
    @MockitoBean JwtDecoder jwtDecoder;

    @Test
    void goLive_returns200WithConnection() throws Exception {
        UUID sid = UUID.randomUUID();
        when(liveSessionService.startLive(eq(USER), eq(sid)))
                .thenReturn(new LiveSessionResponse("wss://x", "jwt", "interview-" + sid,
                        SessionStatus.LIVE_IN_PROGRESS));

        mockMvc.perform(post("/api/v1/interviews/sessions/" + sid + "/live")
                        .with(jwt().jwt(j -> j.subject(USER.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("jwt"))
                .andExpect(jsonPath("$.livekitUrl").value("wss://x"))
                .andExpect(jsonPath("$.status").value("LIVE_IN_PROGRESS"));
    }

    @Test
    void goLive_withoutJwt_isUnauthorized() throws Exception {
        mockMvc.perform(post("/api/v1/interviews/sessions/" + UUID.randomUUID() + "/live"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void getLive_returns200() throws Exception {
        UUID sid = UUID.randomUUID();
        when(liveSessionService.getLive(eq(USER), eq(sid)))
                .thenReturn(new LiveSessionResponse(null, null, null, SessionStatus.PREP_READY));

        mockMvc.perform(get("/api/v1/interviews/sessions/" + sid + "/live")
                        .with(jwt().jwt(j -> j.subject(USER.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PREP_READY"));
    }
}
```
NOTE: `InterviewSessionControllerTest.TestSecurityConfig` is a `static` nested class — reusing it via `@Import` requires it to be package-visible (it is; same package). If `@Import` of another test's nested config is awkward, copy the same `TestSecurityConfig` block into this class.

- [ ] **Step 6: Run it to verify it fails**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='InterviewSessionLiveControllerTest' -o`
Expected: FAIL (endpoints don't exist → 404, or compile error on missing `LiveSessionService` ctor dep).

- [ ] **Step 7: Add the endpoints**

In `InterviewSessionController.java`: add `LiveSessionService` to the constructor, and add:
```java
    @PostMapping("/sessions/{sessionId}/live")
    public ResponseEntity<LiveSessionResponse> goLive(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID sessionId) {
        UUID candidateId = UUID.fromString(jwt.getSubject());
        return ResponseEntity.ok(liveSessionService.startLive(candidateId, sessionId));
    }

    @GetMapping("/sessions/{sessionId}/live")
    public ResponseEntity<LiveSessionResponse> liveState(
            @AuthenticationPrincipal Jwt jwt,
            @PathVariable UUID sessionId) {
        UUID candidateId = UUID.fromString(jwt.getSubject());
        return ResponseEntity.ok(liveSessionService.getLive(candidateId, sessionId));
    }
```
(Add `private final LiveSessionService liveSessionService;` + constructor param + assignment. Import `LiveSessionResponse` + `LiveSessionService`. The existing `@ExceptionHandler(InterviewSessionException.class)` already maps the 404/409 to `ApiError`.)

- [ ] **Step 8: Run both tests to verify they pass**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveSessionServiceTest,InterviewSessionLiveControllerTest' -o`
Expected: PASS (5 + 3).

- [ ] **Step 9: Commit**
```bash
git add src/main/java/com/interviewiq/interviewiq_backend/services/LiveSessionService.java \
        src/main/java/com/interviewiq/interviewiq_backend/services/InterviewSessionException.java \
        src/main/java/com/interviewiq/interviewiq_backend/controllers/InterviewSessionController.java \
        src/test/java/com/interviewiq/interviewiq_backend/services/LiveSessionServiceTest.java \
        src/test/java/com/interviewiq/interviewiq_backend/controllers/InterviewSessionLiveControllerTest.java
git commit -m "feat(live): go-live + resume endpoints (mint token, flip to LIVE_IN_PROGRESS)"
```

---

### Task 4: Internal outcome-ingest endpoint & persistence

**Files:**
- Modify: `src/main/java/com/interviewiq/interviewiq_backend/services/LiveSessionService.java`
- Create: `src/main/java/com/interviewiq/interviewiq_backend/controllers/InternalLiveSessionController.java`
- Test: append to `src/test/java/com/interviewiq/interviewiq_backend/services/LiveSessionServiceTest.java`
- Test: `src/test/java/com/interviewiq/interviewiq_backend/controllers/InternalLiveSessionControllerTest.java`

**Interfaces:**
- Consumes: `InterviewSessionRepository.findById(UUID)` (internal — no owner scope), `tools.jackson.databind.JsonNode` + `ObjectMapper` (Jackson 3), `SessionStatus`, the `outcome`/`endedReason`/`liveScoreFinal`/`durationS`/`liveEndedAt` fields (Task 1).
- Produces: `LiveSessionService.recordOutcome(UUID sessionId, JsonNode outcome): void`. Endpoint `POST /api/v1/internal/sessions/{sessionId}/outcome` guarded by `X-Internal-Api-Key`.

- [ ] **Step 1: Write the failing service test**

Append to `LiveSessionServiceTest.java` (the class already has `sessionRepository`; add an `ObjectMapper` — construct `service` with it; update `@InjectMocks` or build `service` manually in these tests). Add a real `tools.jackson.databind.json.JsonMapper` (not a mock) so JSON parsing is exercised:
```java
    private static final com.fasterxml.jackson.databind.ObjectMapper UNUSED = null; // guard: do NOT import fasterxml

    @Test
    void recordOutcome_persistsJsonbAndFlipsToCompleted() {
        tools.jackson.databind.ObjectMapper om = tools.jackson.databind.json.JsonMapper.builder().build();
        LiveSessionService svc = new LiveSessionService(sessionRepository, liveKit, om);
        UUID sid = UUID.randomUUID();
        InterviewSession s = session(SessionStatus.LIVE_IN_PROGRESS);
        when(sessionRepository.findById(sid)).thenReturn(Optional.of(s));
        when(sessionRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        String body = "{\"session_id\":\"" + sid + "\",\"ended_reason\":\"natural_complete\","
                + "\"live_score_final\":0.66,\"duration_s\":1830.0,\"per_answer_evidence\":[],"
                + "\"negative_events\":[],\"arc_completed\":true,\"extensions_granted\":0,"
                + "\"derived_topics\":[]}";
        svc.recordOutcome(sid, om.readTree(body));

        assertEquals(SessionStatus.COMPLETED, s.getStatus());
        assertEquals("natural_complete", s.getEndedReason());
        assertEquals(0.66, s.getLiveScoreFinal());
        assertEquals(1830, s.getDurationS());
        assertNotNull(s.getLiveEndedAt());
        assertTrue(s.getOutcome().contains("\"session_id\""));
    }

    @Test
    void recordOutcome_abortedTechnical_flipsToAborted() {
        tools.jackson.databind.ObjectMapper om = tools.jackson.databind.json.JsonMapper.builder().build();
        LiveSessionService svc = new LiveSessionService(sessionRepository, liveKit, om);
        UUID sid = UUID.randomUUID();
        InterviewSession s = session(SessionStatus.LIVE_IN_PROGRESS);
        when(sessionRepository.findById(sid)).thenReturn(Optional.of(s));
        when(sessionRepository.save(any())).thenAnswer(i -> i.getArgument(0));

        svc.recordOutcome(sid, om.readTree(
                "{\"ended_reason\":\"aborted_technical\",\"live_score_final\":0.0,\"duration_s\":120.0}"));

        assertEquals(SessionStatus.ABORTED_TECHNICAL, s.getStatus());
    }

    @Test
    void recordOutcome_unknownSession_throwsNotFound() {
        tools.jackson.databind.ObjectMapper om = tools.jackson.databind.json.JsonMapper.builder().build();
        LiveSessionService svc = new LiveSessionService(sessionRepository, liveKit, om);
        UUID sid = UUID.randomUUID();
        when(sessionRepository.findById(sid)).thenReturn(Optional.empty());
        assertThrows(InterviewSessionException.class,
                () -> svc.recordOutcome(sid, om.readTree("{\"ended_reason\":\"early_weak\"}")));
    }
```
NOTE: the existing `@InjectMocks LiveSessionService service` will now need the `ObjectMapper` constructor arg. Either add `@Mock`-free real mapper via `@Spy`, or (as above) build `svc` by hand in the outcome tests and keep `@InjectMocks` for the Task-3 tests by giving `LiveSessionService` a second constructor is NOT allowed (DRY) — instead: add `ObjectMapper` as a 3rd ctor param and let `@InjectMocks` inject a `@Mock ObjectMapper om;` for the Task-3 tests (they don't touch it). Simplest: add `@Mock ObjectMapper objectMapper;` field so `@InjectMocks` satisfies the ctor, and build a real-mapper `svc` locally in the three outcome tests. Update the Task-3 tests only if `@InjectMocks` complains.

- [ ] **Step 2: Run it to verify it fails**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveSessionServiceTest' -o`
Expected: FAIL (`recordOutcome` / 3-arg ctor missing).

- [ ] **Step 3: Implement `recordOutcome`**

Add the `ObjectMapper` dependency to `LiveSessionService` (3rd ctor param, Jackson 3 `tools.jackson.databind.ObjectMapper`) and:
```java
    @Transactional
    public void recordOutcome(UUID sessionId, tools.jackson.databind.JsonNode outcome) {
        InterviewSession s = sessionRepository.findById(sessionId)
                .orElseThrow(InterviewSessionException::notFound);
        String endedReason = outcome.path("ended_reason").asString(null);
        s.setEndedReason(endedReason);
        if (outcome.has("live_score_final") && !outcome.path("live_score_final").isNull()) {
            s.setLiveScoreFinal(outcome.path("live_score_final").asDouble());
        }
        if (outcome.has("duration_s") && !outcome.path("duration_s").isNull()) {
            s.setDurationS((int) Math.round(outcome.path("duration_s").asDouble()));
        }
        s.setOutcome(outcome.toString());
        s.setLiveEndedAt(Instant.now());
        s.setStatus("aborted_technical".equals(endedReason)
                ? SessionStatus.ABORTED_TECHNICAL : SessionStatus.COMPLETED);
        sessionRepository.save(s);
    }
```
NOTE: confirm the Jackson-3 `JsonNode` accessor names via the existing `AiServiceClient` usage (`objectMapper.readTree(...)`). If `asString`/`asDouble` differ in v3, match whatever `AiServiceClient`/other code uses (Jackson 3 renamed some `asText`→`asString`). Keep the behavior identical.

- [ ] **Step 4: Run the service test to verify it passes**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveSessionServiceTest' -o`
Expected: PASS (8 total now).

- [ ] **Step 5: Write the failing controller test**

`src/test/java/com/interviewiq/interviewiq_backend/controllers/InternalLiveSessionControllerTest.java` — the internal endpoint self-guards, so give the slice a permissive security config and test the key branches:
```java
package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.services.LiveSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = InternalLiveSessionController.class,
        properties = "spring.mvc.apiversion.use.path-segment=1")
@Import(InterviewSessionControllerTest.TestSecurityConfig.class)
@TestPropertySource(properties = "internal.api-key=secret-key")
class InternalLiveSessionControllerTest {

    @Autowired MockMvc mockMvc;
    @MockitoBean LiveSessionService liveSessionService;
    @MockitoBean JwtDecoder jwtDecoder;

    private static final String BODY = "{\"ended_reason\":\"natural_complete\"}";

    @Test
    void outcome_withValidKey_persistsAndReturns204() throws Exception {
        UUID sid = UUID.randomUUID();
        mockMvc.perform(post("/api/v1/internal/sessions/" + sid + "/outcome")
                        .header("X-Internal-Api-Key", "secret-key")
                        .contentType("application/json").content(BODY))
                .andExpect(status().isNoContent());
        verify(liveSessionService).recordOutcome(eq(sid), any());
    }

    @Test
    void outcome_withBadKey_is401_andDoesNotPersist() throws Exception {
        UUID sid = UUID.randomUUID();
        mockMvc.perform(post("/api/v1/internal/sessions/" + sid + "/outcome")
                        .header("X-Internal-Api-Key", "wrong")
                        .contentType("application/json").content(BODY))
                .andExpect(status().isUnauthorized());
        verify(liveSessionService, never()).recordOutcome(any(), any());
    }
}
```
NOTE: `TestSecurityConfig` uses `anyRequest().authenticated()`, which would 401 the internal route before the controller's key check runs. Since internal endpoints are `permitAll` in production, give THIS test its own nested `TestSecurityConfig` that `permitAll()`s (copy the block but swap `.authorizeHttpRequests(a -> a.anyRequest().permitAll())`) instead of importing `InterviewSessionControllerTest.TestSecurityConfig`. Then the 401 asserted above comes from the controller's `keyMatches`, not Spring Security.

- [ ] **Step 6: Run it to verify it fails**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='InternalLiveSessionControllerTest' -o`
Expected: FAIL (controller doesn't exist).

- [ ] **Step 7: Implement the internal controller**

`src/main/java/com/interviewiq/interviewiq_backend/controllers/InternalLiveSessionController.java` (mirror `InternalScrapeTargetController`'s key guard):
```java
package com.interviewiq.interviewiq_backend.controllers;

import com.interviewiq.interviewiq_backend.dtos.ApiError;
import com.interviewiq.interviewiq_backend.services.LiveSessionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;

@RestController
@RequestMapping(value = "/api/{version}/internal", version = "1")
public class InternalLiveSessionController {

    private final LiveSessionService liveSessionService;
    private final String internalApiKey;

    public InternalLiveSessionController(
            LiveSessionService liveSessionService,
            @Value("${internal.api-key}") String internalApiKey) {
        this.liveSessionService = liveSessionService;
        this.internalApiKey = internalApiKey;
    }

    @PostMapping("/sessions/{sessionId}/outcome")
    public ResponseEntity<?> recordOutcome(
            @RequestHeader(value = "X-Internal-Api-Key", required = false) String key,
            @PathVariable UUID sessionId,
            @RequestBody JsonNode outcome) {
        if (!keyMatches(key)) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(new ApiError("invalid_internal_key", "missing or invalid internal api key"));
        }
        liveSessionService.recordOutcome(sessionId, outcome);
        return ResponseEntity.noContent().build();
    }

    private boolean keyMatches(String provided) {
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(
                provided.getBytes(StandardCharsets.UTF_8),
                internalApiKey.getBytes(StandardCharsets.UTF_8));
    }
}
```

- [ ] **Step 8: Run both test classes to verify they pass**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='LiveSessionServiceTest,InternalLiveSessionControllerTest' -o`
Expected: PASS (8 + 2).

- [ ] **Step 9: Full-slice regression run + commit**

Run: `JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw test -Dtest='InterviewSessionLiveFieldsTest,LiveKitTokenServiceTest,LiveSessionServiceTest,InterviewSessionLiveControllerTest,InternalLiveSessionControllerTest,InterviewSessionControllerTest,InterviewSessionServiceTest' -o`
Expected: all green (the two existing interview-session classes prove no regression).
```bash
git add src/main/java/com/interviewiq/interviewiq_backend/services/LiveSessionService.java \
        src/main/java/com/interviewiq/interviewiq_backend/controllers/InternalLiveSessionController.java \
        src/test/java/com/interviewiq/interviewiq_backend/services/LiveSessionServiceTest.java \
        src/test/java/com/interviewiq/interviewiq_backend/controllers/InternalLiveSessionControllerTest.java
git commit -m "feat(live): internal outcome-ingest endpoint + persistence (jsonb + status flip)"
```

---

## Self-Review

**Spec coverage (§5.1 of the A design):**
- `SessionStatus` live states → Task 1 ✅
- `InterviewSession` live/outcome columns (nullable, jsonb) → Task 1 ✅
- `LiveKitService` (token) → Task 2 ✅ (room-create/dispatch intentionally NOT here — worker auto-dispatch + room-name parsing; documented in Architecture)
- `POST /sessions/{id}/live` + `GET …/live` → Task 3 ✅
- `POST /internal/sessions/{id}/outcome` + persistence + status flip → Task 4 ✅
- Config `LIVEKIT_*` → Task 2 ✅
- Security (candidate JWT / internal key) → Tasks 3 & 4 ✅

**Deferred to other A slices (not this plan):** the Python worker + real transport + sync/async bridge (ai-service plan), the frontend real `LiveKitLiveSession` + gating (frontend plan). This plan's endpoints are the contract those consume.

**Type consistency:** `LiveSessionResponse(livekitUrl, token, roomName, status)` used identically in Tasks 1/3; `recordOutcome(UUID, JsonNode)` and `startLive/getLive(UUID, UUID)` consistent across service + controller + tests; `ended_reason` snake_case values match the worker's `EndedReason` (`natural_complete|early_weak|time_ceiling|aborted_technical`).

**Placeholder scan:** LiveKit version `0.8.5` + `AccessToken` API carry explicit "verify via context7" steps (external, version-sensitive) — every other code block is complete. Jackson-3 accessor names flagged to confirm against existing `AiServiceClient` usage.

**Known adaptation risks for the implementer:** (1) `InterviewSessionException` may need a `conflict(...)` factory (Task 3 Step 2). (2) `@InjectMocks` + the new `ObjectMapper` ctor arg (Task 4 Step 1 note). (3) Reusing another test's nested `TestSecurityConfig` vs copying it (Tasks 3 & 4 notes). (4) The internal-endpoint web slice needs a `permitAll` security config so the 401 comes from `keyMatches`, not Spring.
