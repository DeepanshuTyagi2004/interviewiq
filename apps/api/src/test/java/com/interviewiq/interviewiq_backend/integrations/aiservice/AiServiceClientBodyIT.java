package com.interviewiq.interviewiq_backend.integrations.aiservice;

import com.interviewiq.interviewiq_backend.config.RestClientConfig;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Regression guard for the "empty file" résumé-parse bug.
 *
 * <p>The default JDK {@link java.net.http.HttpClient} negotiates HTTP/2, so against a cleartext
 * {@code http://} target it attaches an h2c upgrade ({@code Connection: Upgrade}, {@code Upgrade: h2c},
 * {@code HTTP2-Settings}) to every request. The ai-service (uvicorn/h11, HTTP/1.1 only) doesn't
 * upgrade and mishandles that request so the <em>body is never delivered</em> — every body-carrying
 * POST arrived empty. {@link RestClientConfig} pins the client to HTTP/1.1 to prevent this.
 *
 * <p>This test drives the REAL production bean against a capture server and asserts (a) the body
 * lands intact and (b) no h2c-upgrade headers are sent. It fails on the pre-fix config (default
 * HTTP/2 client → {@code Upgrade} header present) and passes once HTTP/1.1 is pinned.
 */
class AiServiceClientBodyIT {

    private HttpServer server;
    private final AtomicInteger receivedLength = new AtomicInteger(-1);
    private final AtomicReference<String> receivedContentType = new AtomicReference<>();
    private final AtomicReference<String> receivedUpgrade = new AtomicReference<>();
    private final AtomicReference<String> receivedConnection = new AtomicReference<>();
    private String baseUrl;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/resumes/parse", exchange -> {
            try (InputStream in = exchange.getRequestBody()) {
                byte[] body = in.readAllBytes();
                receivedLength.set(body.length);
                receivedContentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
                receivedUpgrade.set(exchange.getRequestHeaders().getFirst("Upgrade"));
                receivedConnection.set(exchange.getRequestHeaders().getFirst("Connection"));
            }
            byte[] resp = "{\"full_name\":\"ok\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, resp.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(resp);
            }
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void postsPdfBody_overHttp11_withoutH2cUpgrade() {
        // The actual bean the app wires — not a hand-built RestClient.
        RestClient restClient = new RestClientConfig().restClient();

        byte[] pdfBytes = "%PDF-1.4 hello resume".getBytes(StandardCharsets.UTF_8);

        // Mirror AiServiceClient#parseResume exactly.
        String body = restClient.post()
                .uri(baseUrl + "/resumes/parse")
                .header("X-Internal-Api-Key", "test-key")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes)
                .retrieve()
                .body(String.class);

        assertThat(body).isNotBlank();
        assertThat(receivedContentType.get()).contains("application/pdf");
        assertThat(receivedLength.get())
                .as("bytes the ai-service actually received")
                .isEqualTo(pdfBytes.length);

        // The crux: an HTTP/1.1 client sends no h2c upgrade, so uvicorn delivers the body. Both
        // headers are simply absent (null) on the fixed config; on the pre-fix HTTP/2 client the
        // request carries "Upgrade: h2c" and "Connection: Upgrade, HTTP2-Settings".
        assertThat(receivedUpgrade.get())
                .as("no h2c Upgrade header (would make uvicorn drop the body)")
                .isNull();
        if (receivedConnection.get() != null) {
            assertThat(receivedConnection.get())
                    .as("Connection must not request an upgrade")
                    .doesNotContainIgnoringCase("upgrade");
        }
    }
}
