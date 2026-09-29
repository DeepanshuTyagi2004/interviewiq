# AGENTS.md

## Project Overview

This repository is the Spring Boot backend for InterviewIQ.

- Runtime: Java 25.
- Framework: Spring Boot 4.0.6 with Spring MVC, Spring Security, Spring Data JPA, and DevTools.
- Build tool: Maven through the checked-in Maven wrapper.
- Database: PostgreSQL, configured through environment variables imported from `.env`.
- Base package: `com.interviewiq.interviewiq_backend`.
- Current API style: REST endpoints under `/api/{version}/...` with Spring MVC path-segment API versioning enabled.

Keep changes small, idiomatic, and aligned with the existing Maven/Spring Boot structure. Do not rewrite the project layout or change framework versions unless the task explicitly requires it.

## Repository Layout

- `pom.xml`: Maven dependency and plugin configuration.
- `mvnw`, `mvnw.cmd`, `.mvn/`: Maven wrapper files. Prefer these over a system Maven install.
- `src/main/java/com/interviewiq/interviewiq_backend/`: application code.
- `src/main/resources/application.properties`: application configuration and environment imports.
- `src/test/java/com/interviewiq/interviewiq_backend/`: tests.
- `Dockerfile`: multi-stage container build.
- `target/`: Maven build output. Treat it as generated and do not edit by hand.

## Setup Commands

Use the Maven wrapper from the repository root:

```sh
./mvnw -v
./mvnw clean test
```

The application expects PostgreSQL settings from environment variables, usually loaded through the optional local `.env` file:

```properties
SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/interviewiq
SPRING_DATASOURCE_USERNAME=...
SPRING_DATASOURCE_PASSWORD=...
```

Never commit real secrets. If examples are needed, add a sanitized `.env.example` instead of modifying `.env`.

## Development Workflow

- Start the app locally with `./mvnw spring-boot:run`.
- Build a jar with `./mvnw clean package`.
- Build without tests only when explicitly needed: `./mvnw clean package -DskipTests`.
- The app listens on Spring Boot's default port `8080` unless configuration overrides it.
- The public health check is `GET /api/v1/main/healthcheck`.
- Keep generated files out of commits, especially `target/`, IDE caches, local logs, and local environment files.

When adding new endpoints, keep the existing versioned route shape unless the surrounding API design changes:

```java
@RequestMapping("/api")
@GetMapping(value = "/{version}/resource", version = "1")
```

## Testing Instructions

- Run all tests: `./mvnw test`.
- Run one test class: `./mvnw -Dtest=InterviewiqBackendApplicationTests test`.
- Run one test method: `./mvnw -Dtest=InterviewiqBackendApplicationTests#contextLoads test`.
- Run the full verification lifecycle before handing off larger changes: `./mvnw clean verify`.

Testing expectations:

- Add or update tests for every behavioral change.
- Use JUnit 5 for tests.
- Use focused Spring test slices where practical:
  - `@WebMvcTest` for controller behavior.
  - `@DataJpaTest` for repository behavior.
  - `@SpringBootTest` only when loading the full application context is necessary.
- Use Spring Security test support for authenticated and authorization-sensitive paths.
- For database integration tests, prefer Testcontainers or a dedicated test profile over depending on a developer's local database.
- Avoid tests that require real secrets or production services.

## Code Style

- Use Java conventions and keep formatting consistent with the existing codebase.
- Prefer constructor injection for required dependencies.
- Keep dependency fields `private final`.
- Use clear Spring stereotypes: `@RestController`, `@Service`, `@Repository`, `@Configuration`, and `@Component` where appropriate.
- Put business logic in services, not controllers.
- Keep controllers thin: request validation, delegation, response mapping.
- Use DTOs for API input and output. Do not expose JPA entities directly from controllers.
- Validate request payloads with Jakarta Bean Validation annotations and `@Valid`.
- Use `@ControllerAdvice` plus `@ExceptionHandler` for consistent error responses.
- Keep services stateless unless there is a specific, documented reason not to.
- Use `@Transactional` at service boundaries for database writes and multi-step read consistency.
- Prefer package organization by domain or feature as the application grows.
- Avoid broad, unrelated refactors while implementing a focused task.

## Configuration

- Keep application configuration externalized through `application.properties`, profiles, and environment variables.
- Use `@ConfigurationProperties` for grouped configuration instead of scattering `@Value` fields.
- Add environment-specific files such as `application-dev.properties` or `application-test.properties` only when there is a real need.
- Never hardcode credentials, tokens, database URLs with passwords, API keys, or private URLs.
- Keep `.env` local and uncommitted.

## Persistence

- Use Spring Data JPA repositories for standard CRUD access.
- Use parameterized queries or repository methods; never build SQL through string concatenation with user input.
- Keep entity relationships explicit and avoid lazy-loading surprises in controller serialization.
- Use DTO projections or explicit mappers when returning partial data.
- Add migrations with a standard tool such as Flyway or Liquibase before introducing schema-changing production features. Do not rely on ad hoc manual schema changes for durable behavior.

## Security

- Treat all endpoints as protected by default. Add `permitAll()` only for deliberately public endpoints such as health checks.
- Preserve least-privilege authorization rules in `SecurityConfig`.
- Use Spring Security's built-in mechanisms instead of custom authentication filters unless required.
- Hash passwords with a strong adaptive encoder such as BCrypt if password authentication is introduced.
- Protect state-changing endpoints from CSRF according to the authentication model being used.
- Validate all external input at API boundaries.
- Do not log secrets, credentials, authorization headers, tokens, or full connection strings.

## Logging and Observability

- Use SLF4J through the logger API instead of `System.out.println`.
- Prefer parameterized logging:

```java
logger.info("Created interview {}", interviewId);
```

- Log enough context to debug failures without exposing sensitive data.
- Keep noisy debug logging behind appropriate log levels.
- For new operational endpoints, prefer Spring Boot Actuator if monitoring requirements expand.

## Docker

Build the container image from the repository root:

```sh
docker build -t interviewiq-backend .
```

The Dockerfile builds with Java 25, packages the app through the Maven wrapper, and runs the jar as a non-root `spring` user. Keep that non-root runtime posture unless there is a strong reason to change it.

Pass runtime configuration through environment variables:

```sh
docker run --rm -p 8080:8080 \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://host.docker.internal:5432/interviewiq \
  -e SPRING_DATASOURCE_USERNAME=... \
  -e SPRING_DATASOURCE_PASSWORD=... \
  interviewiq-backend
```

## Pull Request Checklist

Before handing off code changes:

- Run `./mvnw test` for normal changes.
- Run `./mvnw clean verify` for broad, risky, or release-facing changes.
- Confirm new or changed endpoints have tests.
- Confirm security behavior is intentional for public and authenticated routes.
- Confirm no secrets, local paths, generated build outputs, or IDE-only files were added.
- Summarize behavior changes, test coverage, and any known limitations.

## Agent Conduct

- Read the relevant files before editing.
- Prefer `rg` for searching.
- Use the Maven wrapper for project commands.
- Do not edit generated files under `target/`.
- Do not revert user changes unless explicitly asked.
- Keep commits focused if asked to commit.
- If a command fails because required local services or secrets are missing, report the exact blocker and avoid fabricating a successful result.
