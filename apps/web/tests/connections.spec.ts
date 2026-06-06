import { test, expect } from "@playwright/test";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
// Set RUN_AUTHED=1 (and have a live backend session) to run the deep flow.
const AUTHED = process.env.RUN_AUTHED === "1";

test("connections requires auth when logged out", async ({ page }) => {
  test.skip(AUTHED, "authed run covers the deep flow instead");
  await page.goto("/connections");
  await expect(page).toHaveURL(/\/login/);
});

test("authed: sidebar → connections → Connect navigates to authorize", async ({ page }) => {
  test.skip(!AUTHED, "requires a live backend session; set RUN_AUTHED=1");

  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Connections" }).click();
  await expect(page).toHaveURL(/\/connections/);

  // The Connect button is a real anchor-like navigation to the backend.
  // Intercept the top-level navigation to assert the target without leaving.
  const connect = page.getByRole("button", { name: /connect github/i });
  await expect(connect).toBeVisible();

  await page.route("**/api/v1/connections/github/authorize", (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  const [request] = await Promise.all([
    page.waitForRequest(`${API_URL}/api/v1/connections/github/authorize`),
    connect.click(),
  ]);
  expect(request.url()).toBe(`${API_URL}/api/v1/connections/github/authorize`);
});
