package com.interviewiq.interviewiq_backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;

@Configuration
public class RestClientConfig {

    /**
     * Shared RestClient for outbound calls (today: interviewiq-ai-service).
     *
     * <p><b>Pinned to HTTP/1.1 on purpose.</b> The default JDK {@link HttpClient} negotiates
     * HTTP/2, so for a cleartext {@code http://} target it attaches an h2c upgrade to every request
     * ({@code Connection: Upgrade}, {@code Upgrade: h2c}, {@code HTTP2-Settings}). The ai-service runs
     * on uvicorn/h11 (HTTP/1.1 only); it doesn't upgrade, and mishandles the upgrade request so the
     * request <em>body is never delivered</em> to the ASGI app. That silently broke every
     * body-carrying POST (résumé parse, interview-plan generation) — the server saw an empty body
     * ("empty file" 422) even though the bytes were on the wire. Bodyless GET/POST calls were
     * unaffected, which is why it stayed hidden. Forcing HTTP/1.1 drops the upgrade entirely.
     */
    @Bean
    public RestClient restClient() {
        HttpClient httpClient = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        // 120s to match the ai-service's per-attempt LLM_TIMEOUT_SECONDS — a slow single LLM call
        // (e.g. a reasoning model doing a résumé parse) can finish before the backend cancels it.
        requestFactory.setReadTimeout(Duration.ofSeconds(120));

        return RestClient.builder()
                .requestFactory(requestFactory)
                .defaultHeader("Accept", "application/json")
                .build();
    }
}
